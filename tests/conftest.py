import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


@pytest.fixture(scope="session")
def synthetic_dxf(tmp_path_factory):
    from viewtower.synthetic import write
    return write(tmp_path_factory.mktemp("site"))


@pytest.fixture
def small_cfg(synthetic_dxf):
    """Fast config on the synthetic site for end-to-end tests."""
    from viewtower.config import deep_merge, load_config
    cfg = load_config()
    return deep_merge(cfg, {
        "site": {"dxf": str(synthetic_dxf), "boundary_is_envelope": False, "edge_setbacks_m": [9.0, 6.0, 6.0, 9.0]},
        "limits": {"max_fsi_area_m2": 12000, "max_height_m": 90},
        "view": {"raster_res_m": 8.0, "heights_m": [0, 50], "rays": {"max_distance_m": 900.0},
                 "observer_spacing_m": 3.0, "azimuth_step_deg": 5.0},
        "search": {"typologies": [{"typology": "chamfered", "width": [30], "depth": [26], "params": {"chamfer_m": [4.0]}},
                                  {"typology": "curved", "width": [30], "depth": [26]}],
                   "rotation_deg": [0], "units_per_floor": [2], "eval_every": 6},
    })
