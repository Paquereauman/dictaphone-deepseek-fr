"""
Commandes vocales : « valider », « stop », « à la ligne », « annuler »...

Principe de securite : une commande doit occuper **tout** le morceau de phrase
(le morceau est deja decoupe par les pauses). Dire « je vais valider » ne
declenche donc rien, alors que dire « valider » seul, oui.

La comparaison est insensible a la casse, aux accents et a la ponctuation :
« Arrête la dictée. » == « arrete la dictee ».
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Mapping

#: Commandes par defaut, deja normalisees (voir `normalize`).
DEFAULT_COMMANDS: dict[str, list[str]] = {
    # Envoie le message (touche Entree).
    "submit": [
        "valider",
        "valide",
        "envoyer",
        "envoie",
        "envoie le message",
        "vasy",
        "cest bon",
        "parfait envoie",
    ],
    # Arrete la dictee sans envoyer.
    "stop": [
        "stop",
        "arret",
        "arrete",
        "arreter",
        "arrete la dictee",
        "fin de dictee",
        "termine",
    ],
    # Insere un retour a la ligne a l'endroit du curseur.
    "newline": [
        "a la ligne",
        "nouvelle ligne",
        "retour a la ligne",
        "nouveau paragraphe",
    ],
    # Annule ce qui vient d'etre dicte dans ce morceau.
    "cancel": [
        "annuler",
        "annule",
        "efface",
        "efface tout",
        "oublie",
        "laisse tomber",
    ],
    # Annule uniquement le dernier morceau insere.
    "undo": [
        "efface le dernier mot",
        "efface la derniere phrase",
        "corrige ca",
    ],
}

#: Ordre de priorite quand plusieurs commandes pourraient correspondre.
PRIORITY = ("undo", "cancel", "newline", "stop", "submit")

#: Apostrophes et tirets sont **supprimes** (et non remplaces par une espace)
#: pour que « c'est » -> « cest » et « vas-y » -> « vasy ».
_ELISION = re.compile(r"['\u2019`\-]")
_NON_WORD = re.compile(r"[^a-z0-9 ]+")
_SPACES = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Minuscules, sans accents, sans ponctuation, espaces normalises."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    lowered = _ELISION.sub("", stripped.lower())
    return _SPACES.sub(" ", _NON_WORD.sub(" ", lowered)).strip()


def build_index(commands: Mapping[str, Iterable[str]] | None) -> dict[str, str]:
    """normalise(phrase) -> nom de commande."""
    index: dict[str, str] = {}
    for name, phrases in (commands or DEFAULT_COMMANDS).items():
        for phrase in phrases or []:
            key = normalize(phrase)
            if key:
                index[key] = name
    return index


def match_command(
    text: str,
    commands: Mapping[str, Iterable[str]] | None = None,
    whole_segment: bool = True,
) -> tuple[str | None, str]:
    """Renvoie (nom_de_commande, texte_restant).

    `whole_segment=False` autorise la commande en fin de phrase ; elle est
    alors retirees du texte. Desactive par defaut : trop de faux positifs.
    """
    index = build_index(commands)
    if not index:
        return None, text

    heard = normalize(text)
    if not heard:
        return None, text

    if whole_segment:
        return (index[heard], "") if heard in index else (None, text)

    # Mode permissif : on cherche la commande la plus longue en fin de phrase.
    for key in sorted(index, key=len, reverse=True):
        if heard == key or heard.endswith(" " + key):
            # Retire la fin correspondante du texte d'origine.
            words = len(key.split())
            kept = [p for p in re.split(r"\s+", text.strip()) if p]
            rest = " ".join(kept[:-words]) if words else text
            return index[key], rest.strip()
    return None, text


def resolve(settings: Mapping[str, object] | None) -> tuple[dict[str, list[str]], bool]:
    """Construit la table de commandes depuis les reglages.

    `settings` est un dictionnaire plat :
        {"submit": ["valider", "envoyer"], "stop": ["stop"], "whole_segment": true}
    Les categories absentes gardent leur valeur par defaut ; une categorie
    mise a `null` (ou une liste vide) est supprimee.
    """
    settings = settings or {}
    commands: dict[str, list[str]] = {
        name: list(phrases) for name, phrases in DEFAULT_COMMANDS.items()
    }
    for name, phrases in settings.items():
        if name == "whole_segment":
            continue
        if isinstance(phrases, (list, tuple)):
            commands[str(name)] = [str(p) for p in phrases if str(p).strip()]
        elif phrases in (None, "", False):
            commands.pop(str(name), None)
    whole = settings.get("whole_segment")
    return commands, bool(True if whole is None else whole)
