import json

from hotelcore.overview import agent_overview
from hotelcore.tools import load_specs
from tests.test_tools import HOTEL

REPO = HOTEL.root.parents[1]


def test_overview_covers_every_ability_and_text_with_rendered_examples():
    o = agent_overview(HOTEL)
    assert {a["internal_name"] for a in o["what_danny_can_do"]} == set(load_specs(HOTEL))
    texts = {t["internal_name"]: t for t in o["texts_danny_can_send"]}
    assert "booking_link" in texts and "{{" not in json.dumps(o["texts_danny_can_send"])
    assert texts["payment_receipt"]["sent_by"] == "core automatically"
    assert o["facts"]["property.name"] == "Contigo Ranch"


def test_every_path_in_the_overview_exists():
    o = agent_overview(HOTEL)
    paths = [p["path"] for p in o["instructions"]] + o["kb_files"] + o["rule_files"]
    assert paths and all((REPO / p).exists() for p in paths)
    for target in o["where_things_go"].values():
        file_part = target.split(" ")[0]
        if "*" not in file_part and "<" not in file_part and file_part.endswith((".yaml", ".md")):
            assert (REPO / file_part).exists(), file_part
