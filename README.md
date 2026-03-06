# Shadow Threads

> 鍦ㄤ换鎰?LLM 缃戦〉涓婂垱寤哄奖瀛愬瓙绾跨▼瀵硅瘽锛屾繁鍏ユ帰绱㈣€屼笉姹℃煋涓诲璇濅笂涓嬫枃銆?
## 馃専 鐗规€?
- **澶氬钩鍙版敮鎸?*锛欳hatGPT銆丆laude銆丟emini銆侀€氱敤閫傞厤
- **鑷敱閫夋嫨**锛氶€変腑浠绘剰鏂囨湰鐗囨杩涜杩介棶
- **鐙珛涓婁笅鏂?*锛氬瓙绾跨▼鏈夌嫭绔嬬殑瀵硅瘽鍘嗗彶锛屼笉褰卞搷涓诲璇?- **鏅鸿兘璺敱**锛氳嚜鍔ㄤ娇鐢ㄥ綋鍓嶉〉闈㈠搴旂殑 LLM 杩涜鍥炵瓟
- **鏁版嵁鎸佷箙鍖?*锛歅ostgreSQL 瀛樺偍锛屾敮鎸佸巻鍙插洖椤?
## 馃搧 椤圭洰缁撴瀯

```
shadow-threads/
鈹溾攢鈹€ server/                 # 鍚庣鏈嶅姟 (Node.js + Express + Prisma)
鈹?  鈹溾攢鈹€ src/
鈹?  鈹?  鈹溾攢鈹€ api/           # API 璺敱灞?鈹?  鈹?  鈹溾攢鈹€ services/      # 涓氬姟閫昏緫灞?鈹?  鈹?  鈹溾攢鈹€ providers/     # LLM 鎻愪緵鍟嗛€傞厤灞?鈹?  鈹?  鈹溾攢鈹€ middleware/    # 涓棿浠讹紙璁よ瘉銆佹棩蹇椼€侀敊璇鐞嗭級
鈹?  鈹?  鈹溾攢鈹€ utils/         # 宸ュ叿鍑芥暟
鈹?  鈹?  鈹斺攢鈹€ types/         # TypeScript 绫诲瀷瀹氫箟
鈹?  鈹溾攢鈹€ prisma/            # 鏁版嵁搴?Schema 鍜岃縼绉?鈹?  鈹斺攢鈹€ Dockerfile
鈹?鈹溾攢鈹€ extension/              # 娴忚鍣ㄦ墿灞?(Chrome/Edge/Firefox)
鈹?  鈹溾攢鈹€ src/
鈹?  鈹?  鈹溾攢鈹€ adapters/      # 鍚勫钩鍙?DOM 閫傞厤鍣?鈹?  鈹?  鈹溾攢鈹€ ui/            # UI 缁勪欢
鈹?  鈹?  鈹斺攢鈹€ core/          # 鏍稿績閫昏緫
鈹?  鈹斺攢鈹€ manifest.json
鈹?鈹溾攢鈹€ docs/                   # 鏂囨。
鈹溾攢鈹€ docker-compose.yml      # Docker 缂栨帓
鈹斺攢鈹€ README.md
```

## 馃殌 蹇€熷紑濮?
### 鐜瑕佹眰

- Node.js >= 18
- Docker & Docker Compose
- pnpm (鎺ㄨ崘) 鎴?npm

### 1. 鍚姩鏁版嵁搴?
```bash
docker-compose up -d postgres redis
```

### 2. 鍚姩鍚庣

```bash
cd server
pnpm install
pnpm prisma:migrate
pnpm dev
```

### 3. 鏋勫缓鎵╁睍

```bash
cd extension
pnpm install
pnpm build
```

### 4. 鍔犺浇鎵╁睍

鍦ㄦ祻瑙堝櫒涓姞杞?`extension` 鐩綍浣滀负寮€鍙戞墿灞曘€?
## 馃摉 鏂囨。

- [API 鏂囨。](docs/API.md)
- [鏋舵瀯璁捐](docs/ARCHITECTURE.md)
- [寮€鍙戞寚鍗梋(docs/DEVELOPMENT.md)
- [閮ㄧ讲鎸囧崡](docs/DEPLOYMENT.md)

## 馃洜 鎶€鏈爤

**鍚庣**
- Node.js + TypeScript
- Express.js
- Prisma ORM
- PostgreSQL
- Redis

**鎵╁睍**
- TypeScript
- esbuild
- Manifest V3

**LLM 鏀寔**
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude)
- Google (Gemini)
- 鏇村...

## 馃搫 License

MIT
## Selftest Matrix

Shadow Threads selftests are organized into three execution tiers:

- `selftest:fast` - fast checks for active development. Run this for day-to-day work and small changes.
- `selftest:core` - core regression checks. Run this before merging changes that touch core logic or invariants.
- `selftest:full` - full regression checks, including HTTP E2E flows. Run this before major milestones, release candidates, or full regression passes.

Recommended usage:

- During active development: `npm run selftest:fast`
- Before merging core logic changes: `npm run selftest:core`
- Before major milestones or release candidates: `npm run selftest:full`

Example commands:

```bash
npm run build
npm run selftest:fast
npm run selftest:core
npm run selftest:full
```

