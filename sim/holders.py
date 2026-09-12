"""Who rides along: the top holders of the token, read from Robinhood Chain.

Two ways to the same list, and both are here on purpose.

  * the explorer (Blockscout, one request). An ERC-20 contract has no holder
    list in it -- it only knows `balanceOf(address)` -- so a ranking can only
    come from something that has indexed the chain. The chain's own explorer has
    done that, and answers with the top 50 in a single call. This is the fast
    path and the one the broadcast uses before every flight.

  * the chain itself (`--verify`). Balances are rebuilt from `Transfer` events
    from block zero: `balance[to] += value`, `balance[from] -= value`. Slow, but
    it depends on nobody, and it is how the explorer's answer gets checked
    rather than trusted. The public node's limit counts returned logs rather
    than blocks, so the window resizes itself as history thins and thickens.

Not every large balance is a passenger. A liquidity pool and the launch locker
hold tokens without being anybody, so addresses whose role is known are dropped
by name and the reason is written next to each one below. Wallets on this chain
are often contracts too (EIP-7702 delegated accounts, trading vaults) -- being a
contract is therefore not a reason to drop an address here.

    python holders.py                     the crew for the configured token
    python holders.py --token 0x...       another token
    python holders.py --verify            rebuild from chain logs and compare
    python holders.py --json              machine readable
"""
import argparse
import json
import os
import time
from pathlib import Path

import requests

RPC = os.environ.get("RH_RPC", "https://rpc.mainnet.chain.robinhood.com")
EXPLORER = os.environ.get("RH_EXPLORER", "https://robinhoodchain.blockscout.com")
CHAIN_ID = 4663
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ZERO = "0x" + "0" * 40
DEAD = "0x000000000000000000000000000000000000dead"

RUNS = Path(os.environ.get("FLY_SPACE_RUNS", r"E:\test\fly\space-runs"))
SEATS = 10

# No token is written into the code. Which one the passengers come from is
# configuration, not source: a copy of this repository seats nobody until it is
# told what to read, and the page says the seats are placeholders.
DEFAULT_TOKEN = ""


def token_address():
    """Which token the passengers come from: one line in `runs/token.txt`, or
    the FLY_TOKEN environment variable. The file wins, so a running broadcast
    can be pointed at another token by writing one line on the server -- no code
    change and no restart, the next read seats its holders."""
    f = RUNS / "token.txt"
    if f.exists():
        words = f.read_text(encoding="utf-8").strip().split()
        if words and words[0].startswith("0x") and len(words[0]) == 42:
            return words[0].lower()
    return os.environ.get("FLY_TOKEN", DEFAULT_TOKEN).lower()


TOKEN = token_address()

# Balances that belong to the market rather than to a person. Matched against
# the contract's name and the name of what it delegates to, lower-cased.
NOT_A_PASSENGER = (
    "locker",        # PonsV2LaunchLocker: the launch liquidity, locked by the launchpad
    "poolmanager",   # the Uniswap pool the token trades in
    "positionmanager",
    "router",
    "factory",
    "permit2",
)


# ---------------------------------------------------------------- explorer
def _explorer_get(path, params=None, tries=5):
    """Blockscout sits behind Cloudflare, which refuses a plain client; curl_cffi
    speaks a real browser's TLS. It is only used for reading public data.

    The explorer answers 500 now and then under load, so a refusal is retried
    before it is believed -- a flight must not lose its crew to one bad second."""
    try:
        from curl_cffi import requests as cr
        get = lambda: cr.get(EXPLORER + path, params=params, impersonate="chrome", timeout=45)
    except ImportError:
        get = lambda: requests.get(EXPLORER + path, params=params, timeout=45,
                                   headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    back = 1.0
    for attempt in range(tries):
        try:
            r = get()
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except Exception as e:                       # network, TLS, bad JSON
            last = f"{type(e).__name__}: {e}"
        if attempt < tries - 1:
            time.sleep(back)
            back = min(back * 2, 20)
    raise RuntimeError(f"explorer {path} -> {last}")


def token_info(token=TOKEN):
    d = _explorer_get(f"/api/v2/tokens/{token}")
    return {"address": token, "name": d.get("name"), "symbol": d.get("symbol"),
            "decimals": int(d.get("decimals") or 18),
            "total_supply": d.get("total_supply"),
            "holders": int(d.get("holders_count") or 0),
            "price_usd": d.get("exchange_rate")}


def is_pool(rpc, addr, token):
    """A trading pool, asked directly: a Uniswap pool answers token0()/token1()
    and one of them is this token. The V3 pool of this launch is a contract with
    no name at all, so a name list would miss it -- the contract's own answer
    will not."""
    for sel in ("0x0dfe1681", "0xd21220a7"):            # token0(), token1()
        try:
            out = rpc.call("eth_call", [{"to": addr, "data": sel}, "latest"])
        except RpcError:
            return False
        if out and len(out) >= 66 and "0x" + out[-40:] == token:
            return True
    return False


def role_of(addr_obj):
    """What this address is, as far as the chain says: a name if it has one."""
    names = [addr_obj.get("name")] + [i.get("name") for i in (addr_obj.get("implementations") or [])]
    return next((n for n in names if n), None)


def short(addr):
    return addr[:6] + "\u2026" + addr[-4:]


def from_explorer(token=TOKEN):
    """The ranking, one request. Returns every holder the explorer hands back."""
    d = _explorer_get(f"/api/v2/tokens/{token}/holders")
    out = []
    for it in d.get("items", []):
        a = it["address"]
        out.append({"address": a["hash"].lower(), "balance": int(it["value"]),
                    "ens": a.get("ens_domain_name"), "name": role_of(a),
                    "is_contract": bool(a.get("is_contract")),
                    "scam": bool(a.get("is_scam"))})
    return out


# ---------------------------------------------------------------- the chain
class RpcError(RuntimeError):
    pass


class Rpc:
    """Enough JSON-RPC for the verification path, with the public node's manners."""

    PAUSE = 0.05

    def __init__(self, url=RPC):
        self.s = requests.Session()
        self.url = url
        self.pause = self.PAUSE
        self.hits = 0

    def call(self, method, params):
        back, last = 1.0, None
        for _ in range(10):
            try:
                r = self.s.post(self.url, timeout=90, json={
                    "jsonrpc": "2.0", "id": 1, "method": method, "params": params})
                if r.status_code == 429:
                    self.pause = min(self.pause * 1.5 + 0.02, 2.0)
                    last = RpcError("rate limited")
                    time.sleep(back)
                    back = min(back * 2, 30)
                    continue
                d = r.json()
                if "error" in d:
                    raise RpcError(d["error"].get("message", str(d["error"])))
                self.hits += 1
                if self.hits % 40 == 0:
                    self.pause = max(self.PAUSE, self.pause * 0.8)
                time.sleep(self.pause)
                return d["result"]
            except (requests.RequestException, ValueError) as e:
                last = e
                time.sleep(back)
                back = min(back * 2, 30)
        raise RpcError(f"gave up on {method}: {last}")

    def head(self):
        return int(self.call("eth_blockNumber", []), 16)


WIN0 = 200_000
WIN_MAX = 8_000_000
HEAD_LAG = 20                    # blocks left alone, in case the head reorganises


def from_logs(token=TOKEN, rescan=False, verbose=True):
    """Every balance, rebuilt from the token's whole transfer history."""
    token = token.lower()
    rpc = Rpc()
    head = rpc.head() - HEAD_LAG
    cache = RUNS / f"holders-{token}.json"
    last, bal = -1, {}
    if cache.exists() and not rescan:
        d = json.loads(cache.read_text())
        last, bal = int(d["last_block"]), {a: int(v) for a, v in d["balances"].items()}
    win, good, b, n = WIN0, 0, last + 1, 0
    t0 = time.time()
    while b <= head:
        hi = min(b + win - 1, head)
        try:
            logs = rpc.call("eth_getLogs", [{"fromBlock": hex(b), "toBlock": hex(hi),
                                             "address": token, "topics": [TRANSFER]}])
        except RpcError as e:
            msg = str(e).lower()
            if not any(w in msg for w in ("limit", "exceed", "timed out", "too many")):
                raise
            if win == 1:
                raise
            win = max(1, win // 2)          # too much came back, not too far
            good = 0
            continue
        for lg in logs:
            t = lg["topics"]
            data = lg.get("data") or "0x"
            if len(t) != 3 or len(data) < 66:     # four topics is an ERC-721
                continue
            v = int(data[:66], 16)
            if not v:
                continue
            src, dst = "0x" + t[1][-40:], "0x" + t[2][-40:]
            if src != ZERO:
                bal[src] = bal.get(src, 0) - v
            if dst != ZERO:
                bal[dst] = bal.get(dst, 0) + v
        n += len(logs)
        if verbose:
            print(f"\r  block {hi:,}/{head:,}  {n:,} transfers  window {win:,}  "
                  f"{time.time() - t0:4.0f}s", end="", flush=True)
        b, good = hi + 1, good + 1
        if good >= 3 and win < WIN_MAX:
            win, good = min(int(win * 1.5), WIN_MAX), 0
    if verbose:
        print()
    RUNS.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"token": token, "chain_id": CHAIN_ID, "last_block": head,
                                 "updated": int(time.time()), "transfers_seen": n,
                                 "balances": {a: str(v) for a, v in bal.items() if v > 0}}))
    return head, sorted(((a, v) for a, v in bal.items() if v > 0), key=lambda kv: -kv[1])


# ---------------------------------------------------------------- the crew
def crew(token=None, seats=SEATS):
    """The passengers for a flight, as of now."""
    token = (token or token_address()).lower()    # re-read: a long-running broadcast may be repointed
    if not token:
        raise RuntimeError("no token configured: write its address into runs/token.txt "
                           "(or set FLY_TOKEN). Without one there are no passengers.")
    info = token_info(token)
    supply = int(info["total_supply"] or 0)
    rpc = Rpc()
    seated, dropped = [], []
    for h in from_explorer(token):
        role = (h["name"] or "").lower()
        why = None
        if h["address"] in (token, ZERO, DEAD):
            why = "the token contract"
        elif any(w in role for w in NOT_A_PASSENGER):
            why = h["name"]
        elif h["is_contract"] and is_pool(rpc, h["address"], token):
            why = "a trading pool"
        if why:
            dropped.append({"address": h["address"], "why": why,
                            "share": round(100 * h["balance"] / supply, 4) if supply else None})
            continue
        if len(seated) >= seats:
            break
        seated.append({
            "seat": len(seated) + 1,
            "address": h["address"],
            # A wallet on this chain is usually a contract -- an EIP-7702
            # delegated account -- and its implementation's name ("Simple7702
            # Account") says nothing about who owns it. Only a real name is
            # used as a label; otherwise the address is the name.
            "label": h["ens"] or short(h["address"]),
            "wallet_kind": h["name"],
            "balance": str(h["balance"]),
            "amount": h["balance"] / 10 ** info["decimals"],
            "share": round(100 * h["balance"] / supply, 4) if supply else None,
        })
    return {"chain_id": CHAIN_ID, "token": info, "source": "blockscout",
            "measured": int(time.time()), "seats": seated, "not_passengers": dropped}


def verify(token=TOKEN, seats=SEATS):
    """The explorer's answer against the chain's own history."""
    fast = {h["address"]: h["balance"] for h in from_explorer(token)}
    head, ranked = from_logs(token)
    slow = dict(ranked[:50])
    agree = sum(1 for a, v in fast.items() if slow.get(a) == v)
    order_fast = [a for a, _ in sorted(fast.items(), key=lambda kv: -kv[1])][:seats]
    order_slow = [a for a, _ in ranked[:seats]]
    return {"block": head, "explorer_rows": len(fast), "exact_matches": agree,
            "top_order_same": order_fast == order_slow,
            "explorer_top": order_fast, "chain_top": order_slow}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=None)
    ap.add_argument("--seats", type=int, default=SEATS)
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.verify:
        print(json.dumps(verify((a.token or token_address()).lower(), a.seats), indent=1))
        return
    c = crew(a.token, a.seats)
    if a.json:
        print(json.dumps(c, indent=1))
        return
    t = c["token"]
    print(f"\n{t['name']} ({t['symbol']}) {t['address']}")
    print(f"chain {CHAIN_ID}, {t['holders']:,} addresses hold it, "
          f"supply {int(t['total_supply'] or 0) / 10 ** t['decimals']:,.0f}\n")
    for s in c["seats"]:
        print(f"  seat {s['seat']:2d}  {s['label']:<22} {s['amount']:>16,.2f}  {s['share']:6.2f}%")
    if c["not_passengers"]:
        print("\nnot passengers (the market, not a person):")
        for d in c["not_passengers"]:
            print(f"  {short(d['address'])}  {d['why']}")


if __name__ == "__main__":
    main()
