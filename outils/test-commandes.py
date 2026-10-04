"""
Verifie les commandes vocales et le nettoyage, sans serveur ni micro.

    .venv\\Scripts\\python.exe outils\\test-commandes.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.cleanup import apply_replacements, clean_text, french_typography  # noqa: E402
from server.commands import DEFAULT_COMMANDS, match_command, normalize, resolve  # noqa: E402


def load_config() -> dict:
    try:
        return json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"config.json illisible : {exc}")
        return {}


def main() -> int:
    cfg = load_config()
    commands, whole = resolve(cfg.get("voice_commands") or {})

    print("=" * 72)
    print("  COMMANDES VOCALES")
    print("=" * 72)
    print(f"  morceau entier obligatoire : {whole}")
    for name, phrases in commands.items():
        print(f"  {name:9} : {', '.join(phrases)}")
    print()

    # (phrase entendue, commande attendue)
    cases = [
        ("Valider.", "submit"),
        ("valider", "submit"),
        ("Envoie le message", "submit"),
        ("Vas-y", "submit"),
        ("C'est bon !", "submit"),        ("Arrête la dictée.", "stop"),
        ("Stop.", "stop"),
        ("À la ligne", "newline"),
        ("Nouveau paragraphe", "newline"),
        ("Annuler", "cancel"),
        ("Efface le dernier mot", "undo"),
        # Ne doivent PAS declencher de commande :
        ("Je vais valider le formulaire.", None),
        ("Bonjour, ceci est un test de dictée.", None),
        ("Il faut que tu envoies ça plus tard", None),
        ("", None),
    ]

    failures = 0
    for heard, expected in cases:
        got, rest = match_command(heard, commands, whole)
        ok = got == expected
        failures += 0 if ok else 1
        mark = "ok " if ok else "ECHEC"
        shown = repr(heard) if len(heard) < 44 else repr(heard[:41] + "...")
        print(f"  [{mark}] {shown:47} -> {str(got):8} attendu={expected}")

    print()
    print("=" * 72)
    print("  NORMALISATION / NETTOYAGE")
    print("=" * 72)
    samples = [
        "Arrête la dictée, s'il te plaît !",
        "Euh, alors voilà, je voulais dire…",
    ]
    for s in samples:
        print(f"  brut       : {s!r}")
        print(f"  normalise  : {normalize(s)!r}")

    print(f"  typo fr    : {french_typography('Bonjour !  Ça va ?  « test »')!r}")
    print(f"  typo off   : {clean_text('Bonjour !  Ça va ?', {})!r}")
    print(f"  rempl.     : {apply_replacements('deep sea et fast api', {'deep sea': 'DeepSeek', 'fast api': 'FastAPI'})!r}")
    print(f"  joker      : {apply_replacements('deepseas partout', {'deepsea*': 'DeepSeek'})!r}")

    print()
    if failures:
        print(f"  {failures} cas en echec")
    else:
        print("  Tous les cas passent.")
    print("=" * 72)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
