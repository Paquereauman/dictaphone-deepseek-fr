"""
Nettoyage local du texte dicte (aucun appel reseau).

Volontairement simple : on ne cherche pas a corriger la grammaire, seulement a
rendre le texte dicte directement utilisable dans un chat.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

_FILLERS = re.compile(
    r"(?<![\w'-])(?:euh+|heu+|hum+|hmm+|bah|ben|bref|voil[aà]|en fait|tu vois|du coup)"
    r"(?![\w'-])",
    re.IGNORECASE,
)

_MULTISPACE = re.compile(r"[ \t\u00a0\u202f]{2,}")
_SPACE_BEFORE_PUNCT = re.compile(r"[ \t\u00a0\u202f]+([,.;:!?])")
_ORPHAN_PUNCT = re.compile(r"^[\s,.;:!?-]+")
_HESITATION_COMMA = re.compile(r",\s*,")

#: Typographie francaise : espace insecable avant ; : ! ? et a l'interieur des
#: guillemets. Desactivee par defaut (elle modifie le texte de facon invisible).
_FR_TYPO = (
    (re.compile(r"[ \t\u00a0\u202f]*([;:!?])"), "\u00a0\\1"),
    (re.compile(r"[ \t\u00a0\u202f]*»"), "\u00a0»"),
    (re.compile(r"«[ \t\u00a0\u202f]*"), "«\u00a0"),
)


def clean_text(
    text: str,
    options: Mapping[str, Any] | None = None,
    replacements: Mapping[str, str] | None = None,
) -> str:
    """Applique le nettoyage configure.

    `options`  = section `cleanup` de config.json (ou reglages de l'extension).
    `replacements` = dictionnaire de corrections ; s'il est fourni, il remplace
    celui de `options` (permet de surcharger par session, sans redemarrer).
    """
    opts = dict(options or {})
    if not opts.get("enabled", True):
        return _tidy(text)

    out = _tidy(text)

    if opts.get("remove_fillers", True):
        out = _FILLERS.sub("", out)
        out = _HESITATION_COMMA.sub(",", out)
        out = _tidy(out)

    table = replacements if replacements is not None else opts.get("replacements")
    out = apply_replacements(out, table)

    if opts.get("capitalize", True):
        out = _capitalize(out)

    if opts.get("french_typography", False):
        out = french_typography(out)

    return out.strip()


def apply_replacements(text: str, replacements: Mapping[str, str] | None) -> str:
    """Remplace des expressions entieres (insensible a la casse).

    Les cles peuvent contenir un `*` final pour autoriser un suffixe
    (« deepsea* » corrigerait « deepsea » et « deepseas »).
    """
    out = text or ""
    for src, dst in (replacements or {}).items():
        src = str(src).strip()
        if not src:
            continue
        prefix = r"(?<![\w'-])"
        suffix = r"[\w'-]*" if src.endswith("*") else r"(?![\w'-])"
        pattern = rf"{prefix}{re.escape(src.rstrip('*'))}{suffix}"
        try:
            out = re.sub(pattern, str(dst), out, flags=re.IGNORECASE)
        except re.error:
            continue
    return out


def french_typography(text: str) -> str:
    """Espaces insecables avant ; : ! ? et dans les guillemets francais."""
    out = text or ""
    for pattern, repl in _FR_TYPO:
        out = pattern.sub(repl, out)
    return out


def _tidy(text: str) -> str:
    out = (text or "").replace("\u2019", "'")
    out = _MULTISPACE.sub(" ", out)
    out = _SPACE_BEFORE_PUNCT.sub(r"\1", out)
    out = _ORPHAN_PUNCT.sub("", out)
    return out.strip()


def _capitalize(text: str) -> str:
    if not text:
        return text
    out = list(text)
    start_of_sentence = True
    for i, ch in enumerate(out):
        if start_of_sentence and ch.isalpha():
            out[i] = ch.upper()
            start_of_sentence = False
        elif ch in ".!?":
            start_of_sentence = True
        elif ch == "\n":
            start_of_sentence = True
    return "".join(out)
