from pathlib import Path

import pytest

from hotelcore.config import load_hotel
from hotelcore.render import MissingFact, render

HOTELS = Path(__file__).resolve().parent.parent / "hotels"


@pytest.fixture(scope="module")
def contigo():
    return load_hotel(HOTELS / "contigo-ranch")


def test_loads_facts_kb_and_policies(contigo):
    assert contigo.hotel_id == "contigo-ranch"
    assert contigo.facts["property"]["name"] == "Contigo Ranch"
    assert len(contigo.kb) == 31
    assert "pets" in contigo.policies


def test_every_doc_renders_with_no_missing_facts(contigo):
    for doc in [*contigo.kb.values(), *contigo.policies.values()]:
        assert "{{" not in contigo.render(doc), doc.id


def test_rendered_values_come_from_facts(contigo):
    text = contigo.render(contigo.kb["check-in-check-out"])
    assert f"Standard Check-in:** {contigo.facts['checkin']['time']}" in text


def test_unknown_fact_raises():
    with pytest.raises(MissingFact):
        render("Wifi: {{facts.wifi.password}}", {"checkin": {"time": "3 PM"}})
