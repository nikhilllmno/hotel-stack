"""search_knowledge_base: rendered kb sections by title, read at call time so edits apply immediately."""

from hotelcore.tools.context import ToolContext


def topic_titles(ctx: ToolContext) -> list[str]:
    return [doc.title for doc in ctx.hotel.kb.values()]


def search_knowledge_base(ctx: ToolContext, topics: list[str]) -> dict:
    by_key = {}
    for doc in ctx.hotel.kb.values():
        by_key[doc.title.lower()] = doc
        by_key[doc.id.lower()] = doc
    found, unknown = [], []
    for topic in topics[:3]:
        doc = by_key.get(topic.strip().lower())
        if doc:
            found.append({"title": doc.title, "content": ctx.hotel.render(doc)})
        else:
            unknown.append(topic)
    result = {"sections": found}
    if unknown:
        result["unknown_topics"] = unknown
        result["available_topics"] = topic_titles(ctx)
    return result
