from hotelcore.publish import stale_copy_of

V = {"version": "v4", "firstMessage": "Hi", "model": {"model": "gpt-4.1", "temperature": 0, "messages": [{"content": "old prompt"}]},
     "maxDurationSeconds": 1614, "startSpeakingPlan": {"waitSeconds": 0.1}, "voice": {"voiceId": "Elliot"}}


def test_draft_identical_to_an_old_version_is_stale():
    draft = {**V, "version": None, "id": "d1", "createdBy": "someone", "baseVersion": "v11"}
    assert stale_copy_of(draft, [{**V, "version": "v12", "maxDurationSeconds": 900}, V]) == "v4"


def test_draft_with_any_new_edit_is_not_stale():
    edited = {**V, "model": {**V["model"], "messages": [{"content": "new prompt"}]}}
    timing = {**V, "startSpeakingPlan": {"waitSeconds": 0.3}}
    assert stale_copy_of(edited, [V]) is None and stale_copy_of(timing, [V]) is None
