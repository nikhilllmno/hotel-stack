"""Load a hotel's config-as-code folder: hotels/<hotel-id>/{facts.yaml, kb/, policies/}."""

from dataclasses import dataclass
from pathlib import Path

import yaml

from hotelcore.render import render


@dataclass(frozen=True)
class Doc:
    """One markdown file with YAML front matter. `body` is the unrendered template."""

    id: str
    title: str
    meta: dict
    body: str


@dataclass(frozen=True)
class HotelConfig:
    hotel_id: str
    root: Path
    facts: dict
    kb: dict[str, Doc]
    policies: dict[str, Doc]

    def render(self, doc: Doc) -> str:
        return render(doc.body, self.facts)


def parse_doc(path: Path) -> Doc:
    """Split '---' front matter from the markdown body."""
    text = path.read_text()
    meta, body = {}, text
    if text.startswith("---\n"):
        header, body = text[4:].split("\n---\n", 1)
        meta = yaml.safe_load(header) or {}
    doc_id = meta.get("id", path.stem)
    return Doc(id=doc_id, title=meta.get("title", doc_id), meta=meta, body=body.strip())


def load_docs(folder: Path) -> dict[str, Doc]:
    docs = [parse_doc(p) for p in sorted(folder.glob("*.md"))]
    return {d.id: d for d in docs}


def load_hotel(root: Path) -> HotelConfig:
    root = Path(root)
    return HotelConfig(
        hotel_id=root.name,
        root=root,
        facts=yaml.safe_load((root / "facts.yaml").read_text()),
        kb=load_docs(root / "kb"),
        policies=load_docs(root / "policies"),
    )
