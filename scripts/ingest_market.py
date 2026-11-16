#!/usr/bin/env python3
"""EOD price & volume for the portfolio -> data/market.json

Stores ~6 months of raw daily close/volume per holding (not pre-computed alerts), so the client can
re-evaluate tripwires for ANY threshold the investor chooses and show how noisy that threshold would
have been historically ("at 2.0x volume you'd have had 9 alerts this month; at 3.0x, 2").

Usage: python3 scripts/ingest_market.py          (needs: pip install yfinance)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")


def main():
    pf = json.load(open(os.path.join(DATA, "portfolio.json")))
    syms = [h["symbol"] for h in pf["holdings"]]
    index = "^NSEI"  # Nifty 50: lets FINN separate stock-specific moves from market-wide ones
    tickers = [f"{s}.NS" for s in syms] + [index]
    df = yf.download(tickers, period="9mo", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    out = {"asOf": datetime.now(timezone.utc).isoformat(), "source": "Yahoo Finance via yfinance (EOD, NSE)", "series": {}}
    for t in tickers:
        try:
            d = df[t][["Close", "Volume"]].dropna()
        except KeyError:
            print("missing", t, file=sys.stderr)
            continue
        d = d.tail(130)
        key = "NIFTY" if t == index else t.replace(".NS", "")
        out["series"][key] = {
            "d": [i.strftime("%Y-%m-%d") for i in d.index],
            "c": [round(float(x), 2) for x in d["Close"]],
            "v": [int(x) if not math.isnan(x) else 0 for x in d["Volume"]],
        }
        print(f"{key:12s} {len(d)} days, last {out['series'][key]['d'][-1]} close {out['series'][key]['c'][-1]}")
    json.dump(out, open(os.path.join(DATA, "market.json"), "w"), separators=(",", ":"))
    print("-> data/market.json")


if __name__ == "__main__":
    main()
