"""Live weather feature tests — real RH/ssrd derivations, tail clamp, extremes.

Covers the fixes to features/weather.py:
- relative humidity + solar radiation derive from the HOURLY series (the two
  previously-documented gaps in the classifier's 43-feature schema);
- temperature max/min are window extremes (max of maxima / min of minima),
  not averages of the daily series;
- the ERA5 archive tail is learned from a 400 body and clamped (the old
  `today-1` end date 400'd on every fresh point, silently degrading weather
  to the 0.0 training prior).
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

import httpx
import pytest

from app.features import weather as wx_mod


def _daily_payload(days: int = 3) -> dict:
    start = date(2026, 9, 1)
    return {
        "daily": {
            "time": [(start + timedelta(days=i)).isoformat() for i in range(days)],
            "temperature_2m_mean": [28.0, 29.0, None],
            "temperature_2m_max": [34.0, 36.5, 35.0],
            "temperature_2m_min": [22.0, None, 24.0],
            "wind_speed_10m_max": [6.0, 7.5, 5.0],
            "wind_speed_10m_mean": [2.0, 3.0, 2.5],
            "dew_point_2m_mean": [18.0, 19.0, 17.0],
            "precipitation_sum": [0.0, 12.0, 3.0],
        }
    }


def _hourly_payload(days: int = 3, hours_per_day: int = 2) -> dict:
    start = date(2026, 9, 1)
    times: list[str] = []
    rh: list[float | None] = []
    sw: list[float | None] = []
    for d in range(days):
        day = start + timedelta(days=d)
        for h in range(hours_per_day):
            times.append(f"{day.isoformat()}T{h:02d}:00")
            rh.append(60.0 + d * 10 + h)  # day0: 60,61; day1: 70,71 ...
            sw.append(100.0 * (d + 1) + h * 10)  # day0: 100,110 ...
    # one null gap to prove filtering
    rh[1] = None
    return {"hourly": {"time": times, "relative_humidity_2m": rh, "shortwave_radiation": sw}}


def _mock_transport(daily_status: int = 200, hourly_status: int = 200):
    """httpx MockTransport serving the daily + hourly archive endpoints.

    With daily_status=400 the FIRST daily request fails with a tail-bearing
    error body (as the real archive does) and the retry after clamping
    succeeds — proving the one-shot tail discovery works end to end.
    """
    daily_requests = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        if "daily" in params:
            daily_requests["n"] += 1
            if daily_status == 400 and daily_requests["n"] == 1:
                return httpx.Response(
                    400,
                    text='{"reason": \'Parameter "end_date" is out of allowed range (2026-09-04)\'}',
                )
            return httpx.Response(200, json=_daily_payload())
        if "hourly" in params:
            return httpx.Response(hourly_status, json=_hourly_payload() if hourly_status == 200 else {})
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _reset_weather_state():
    wx_mod._cache.clear()
    wx_mod._archive_tail = None
    yield
    wx_mod._cache.clear()
    wx_mod._archive_tail = None


@pytest.mark.asyncio
async def test_rh_and_ssrd_derived_from_hourly_series():
    res = await wx_mod.get_weather(28.6, 77.2, transport=_mock_transport())
    assert res.provenance == "open-meteo"
    f = res.features
    # RH day0 = mean(60) [61 was None], day1 = mean(70,71)=70.5, day2=mean(80,81)=80.5
    assert f["mean_relative_humidity"] == pytest.approx((60.0 + 70.5 + 80.5) / 3, abs=1e-4)
    # min RH = min over all hourly values (60.0)
    assert f["min_relative_humidity"] == pytest.approx(60.0, abs=1e-6)
    # ssrd day0 = mean(100,110)=105, day1=mean(200,210)=205, day2=mean(300,310)=305
    assert f["mean_ssrd"] == pytest.approx((105.0 + 205.0 + 305.0) / 3, abs=1e-4)
    assert f["max_ssrd"] == pytest.approx(310.0, abs=1e-6)


@pytest.mark.asyncio
async def test_temperature_extremes_are_window_extremes():
    res = await wx_mod.get_weather(28.6, 77.2, transport=_mock_transport())
    f = res.features
    assert f["max_temperature"] == pytest.approx(36.5)  # max of maxima, not mean(35.17)
    assert f["min_temperature"] == pytest.approx(22.0)  # min of minima
    assert f["max_wind_speed"] == pytest.approx(7.5)
    # real daily mean wind present → used directly
    assert f["mean_wind_speed"] == pytest.approx((2.0 + 3.0 + 2.5) / 3, abs=1e-4)


@pytest.mark.asyncio
async def test_archive_tail_learned_from_400_and_clamped():
    # First daily request 400s with a tail date; the module must learn it,
    # clamp, and retry — ending with a successful derivation.
    res = await wx_mod.get_weather(28.6, 77.2, transport=_mock_transport(daily_status=400))
    assert res.provenance == "open-meteo"
    assert wx_mod._archive_tail == date(2026, 9, 4)
    assert res.features["mean_temperature"] is not None


@pytest.mark.asyncio
async def test_hourly_failure_degrades_only_rh_ssrd():
    res = await wx_mod.get_weather(28.6, 77.2, transport=_mock_transport(hourly_status=500))
    f = res.features
    assert res.provenance == "open-meteo"
    assert f["mean_temperature"] is not None
    assert f["mean_relative_humidity"] is None
    assert f["min_relative_humidity"] is None
    assert f["mean_ssrd"] is None
    assert f["max_ssrd"] is None


@pytest.mark.asyncio
async def test_daily_failure_is_unavailable():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    res = await wx_mod.get_weather(28.6, 77.2, transport=httpx.MockTransport(handler))
    assert res.provenance == "unavailable"
    assert all(v is None for v in res.features.values())


@pytest.mark.asyncio
async def test_cache_hit_skips_transport():
    tx = _mock_transport()
    first = await wx_mod.get_weather(28.6, 77.2, transport=tx)
    second = await wx_mod.get_weather(28.6, 77.2, transport=tx)
    assert second.provenance == "cache"
    assert second.features == first.features
