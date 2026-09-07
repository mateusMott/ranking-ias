#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from difflib import SequenceMatcher

import requests
import pandas as pd


# =========================================================
# CONFIGURAÇÃO
# =========================================================

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "models.json"

AA = "https://artificialanalysis.ai/leaderboards/models/"
ARENA = "https://arena.ai/leaderboard/text"
SWEN = "https://swen.ai/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/151 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

TIMEOUT = 35


# =========================================================
# UTILIDADES
# =========================================================

def norm(s):
    s = unicodedata.normalize("NFKD", str(s))
    s = s.encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")[:80]


def num(v):
    if v is None:
        return None

    s = str(v).strip()

    if not s or s.lower() == "nan":
        return None

    s = s.replace(",", "")

    m = re.search(r"-?\d+(?:\.\d+)?", s)

    return float(m.group()) if m else None


def context_k(v):
    if v is None:
        return None

    s = str(v).lower().replace(",", "").strip()
    n = num(s)

    if n is None:
        return None

    if "m" in s:
        return round(n * 1024)

    if "k" in s:
        return round(n)

    return round(n)


def fetch(url):
    print(f"Buscando: {url}")

    r = requests.get(
        url,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    r.raise_for_status()

    content_type = r.headers.get("content-type", "")

    if "text/html" not in content_type:
        print(
            f"Aviso: resposta inesperada de {url}: "
            f"{content_type}"
        )

    print(
        f"Resposta recebida: status={r.status_code}, "
        f"{len(r.text)} caracteres"
    )

    return r.text


# =========================================================
# ARTIFICIAL ANALYSIS
# =========================================================

def parse_aa():
    html = fetch(AA)

    try:
        tables = pd.read_html(html)
    except Exception as e:
        raise RuntimeError(
            f"Não foi possível interpretar tabelas da Artificial Analysis: {e}"
        )

    target = None

    for table in tables:
        cols = " | ".join(map(str, table.columns))

        if (
            "Intelligence" in cols
            and "Model" in cols
        ):
            target = table
            break

    if target is None:
        raise RuntimeError(
            "Tabela principal da Artificial Analysis não encontrada"
        )

    target.columns = [
        " ".join(
            str(x)
            for x in c
            if str(x) != "nan"
        ).strip()
        if isinstance(c, tuple)
        else str(c)
        for c in target.columns
    ]

    out = []

    for _, row in target.iterrows():

        def col(*terms):
            for c in target.columns:
                lc = c.lower()

                if all(
                    term.lower() in lc
                    for term in terms
                ):
                    return row[c]

            return None

        name = col("model")

        if name is None:
            continue

        name = str(name).strip()

        if not name or name.lower() == "nan":
            continue

        creator = col("creator")

        creator = (
            str(creator).strip()
            if creator is not None
            else "—"
        )

        intelligence = num(col("intelligence"))

        if intelligence is None:
            continue

        price = (
            num(col("cost", "task"))
            or num(col("cost"))
        )

        speed = (
            num(col("tokens", "s"))
            or num(col("speed"))
        )

        latency = num(col("latency"))

        context = context_k(col("context"))

        out.append(
            {
                "id": slug(name),
                "name": name,
                "company": creator,
                "type": "Proprietário",

                "intelligence": intelligence,
                "price": price,
                "speed": speed,
                "latency": latency,
                "context": context,

                "elo": None,

                "sources": "AA v4.2",

                "description": (
                    "Métricas atualizadas automaticamente "
                    "a partir da Artificial Analysis."
                ),

                "swen": None,
            }
        )

    if len(out) < 5:
        raise RuntimeError(
            f"Parser da Artificial Analysis retornou apenas {len(out)} modelos"
        )

    print(
        f"Artificial Analysis: {len(out)} modelos encontrados"
    )

    return out


# =========================================================
# ARENA
# =========================================================

def parse_arena():
    try:
        html = fetch(ARENA)
    except Exception as e:
        print(
            f"Aviso Arena: falha ao baixar página: {e}"
        )
        return []

    # Proteção contra HTML dinâmico/Next.js sem tabela estática.
    if "__next_f.push" in html:
        print(
            "Aviso Arena: página dinâmica Next.js detectada. "
            "A coleta da Arena será ignorada nesta execução."
        )
        return []

    try:
        tables = pd.read_html(html)
    except Exception:
        print(
            "Aviso Arena: nenhuma tabela HTML legível encontrada."
        )
        return []

    if not tables:
        print(
            "Aviso Arena: nenhuma tabela encontrada."
        )
        return []

    target = max(
        tables,
        key=lambda t: len(t)
    )

    target.columns = [
        " ".join(
            str(x)
            for x in c
            if str(x) != "nan"
        ).strip()
        if isinstance(c, tuple)
        else str(c)
        for c in target.columns
    ]

    rows = []

    for _, row in target.iterrows():
        name = None
        score = None

        for c in target.columns:
            lc = c.lower()

            if (
                "model" in lc
                and name is None
            ):
                name = row[c]

            if (
                ("score" in lc or "elo" in lc)
                and score is None
            ):
                score = row[c]

        if name is None or score is None:
            continue

        n = num(score)

        if n is None:
            continue

        rows.append(
            (
                str(name).strip(),
                n
            )
        )

    print(
        f"Arena: {len(rows)} entradas encontradas"
    )

    return rows


# =========================================================
# MATCH DE MODELOS
# =========================================================

def best_match(name, arena):
    a = norm(name)

    best = (
        0,
        None,
        None
    )

    for nm, score in arena:
        b = norm(nm)

        ratio = SequenceMatcher(
            None,
            a,
            b
        ).ratio()

        ta = set(a.split())
        tb = set(b.split())

        overlap = (
            len(ta & tb)
            / max(
                len(ta | tb),
                1
            )
        )

        ratio += 0.15 * overlap

        if ratio > best[0]:
            best = (
                ratio,
                nm,
                score
            )

    if best[0] >= 0.68:
        return best

    return (
        0,
        None,
        None
    )


# =========================================================
# VALIDAÇÃO
# =========================================================

def validate_models(models):
    if len(models) < 5:
        raise RuntimeError(
            "Snapshot inválido: poucos modelos"
        )

    valid_scores = [
        m["intelligence"]
        for m in models
        if m.get("intelligence") is not None
    ]

    if len(valid_scores) < 5:
        raise RuntimeError(
            "Snapshot inválido: inteligência ausente"
        )

    if max(valid_scores) > 100:
        raise RuntimeError(
            "Snapshot inválido: score de inteligência fora da escala esperada"
        )

    if min(valid_scores) < 0:
        raise RuntimeError(
            "Snapshot inválido: score negativo"
        )


# =========================================================
# MAIN
# =========================================================

def main():

    errors = []

    old = None

    if DATA.exists():
        try:
            old = json.loads(
                DATA.read_text(
                    encoding="utf-8"
                )
            )
        except Exception:
            print(
                "Aviso: models.json existente não pôde ser lido."
            )

    # Artificial Analysis é obrigatória
    try:
        aa = parse_aa()

    except Exception as e:
        aa = []

        errors.append(
            "Artificial Analysis: "
            + str(e)
        )

    # Arena é opcional
    try:
        arena = parse_arena()

    except Exception as e:
        arena = []

        errors.append(
            "Arena: "
            + str(e)
        )

    if not aa:
        print(
            "ERRO: Artificial Analysis não pôde ser atualizada."
        )

        if errors:
            for error in errors:
                print(
                    "-",
                    error
                )

        raise SystemExit(
            "Atualização cancelada para preservar o último snapshot válido."
        )

    # Enriquece com Arena quando disponível
    matched = 0

    for m in aa:

        score = best_match(
            m["name"],
            arena
        )

        if score[1]:
            m["elo"] = round(
                score[2]
            )

            m["sources"] = (
                "AA v4.2 · Arena"
            )

            matched += 1

        text = norm(
            m["name"]
            + " "
            + m["company"]
        )

        open_terms = [
            "qwen",
            "kimi",
            "glm",
            "deepseek",
            "granite",
            "llama",
            "mimo",
            "ling",
        ]

        if any(
            x in text
            for x in open_terms
        ):
            m["type"] = (
                "Código aberto"
            )

    aa.sort(
        key=lambda m: (
            m.get("intelligence")
            or -1,

            m.get("elo")
            or -1,
        ),
        reverse=True
    )

    models = aa[:35]

    validate_models(
        models
    )

    now = (
        datetime
        .now(timezone.utc)
        .isoformat(
            timespec="seconds"
        )
    )

    result = {
        "version": (
            datetime
            .now()
            .strftime("%Y-%m-%d")
        ),

        "updated_at": now,

        "benchmark_version":
            "Artificial Analysis Intelligence Index v4.2",

        "sources": [
            {
                "name":
                    "Artificial Analysis",

                "url":
                    AA,

                "ok":
                    True,
            },

            {
                "name":
                    "Arena",

                "url":
                    ARENA,

                "ok":
                    bool(arena),

                "note":
                    (
                        None
                        if arena
                        else
                        "Arena indisponível ou página dinâmica; "
                        "último snapshot técnico preservado."
                    ),
            },

            {
                "name":
                    "SWEN.AI",

                "url":
                    SWEN,

                "ok":
                    False,

                "note":
                    (
                        "Fonte editorial complementar; "
                        "não usada automaticamente enquanto "
                        "não houver estrutura verificável."
                    ),
            },
        ],

        "models":
            models,

        "warnings":
            errors,

        "notes":
            (
                "Gerado automaticamente. "
                "Artificial Analysis é a fonte técnica primária. "
                "Arena adiciona preferência humana apenas "
                "quando a coleta é confiável."
            ),
    }

    new_json = json.dumps(
        result,
        ensure_ascii=False,
        indent=2
    )

    # Evita commit desnecessário quando só o timestamp muda.
    comparable_new = {
        **result,
        "updated_at": None,
        "version": None,
    }

    comparable_old = None

    if isinstance(old, dict):
        comparable_old = {
            **old,
            "updated_at": None,
            "version": None,
        }

    if comparable_old == comparable_new:
        print(
            "Nenhuma mudança relevante nos rankings."
        )

        return

    DATA.write_text(
        new_json,
        encoding="utf-8"
    )

    print(
        f"Atualização concluída: {len(models)} modelos."
    )

    print(
        f"Arena associada a {matched} modelos."
    )

    if errors:
        print(
            f"Avisos: {len(errors)}"
        )

        for error in errors:
            print(
                "-",
                error
            )


if __name__ == "__main__":
    main()
