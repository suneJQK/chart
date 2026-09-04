# Huong Dan Trien Khai

## 1. Trien khai len Vercel

1. Day source code len GitHub.
2. Tao project tren Vercel va ket noi repo.
3. Trong Vercel Project Settings > Environment Variables, them:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (tuy chon, mac dinh `gpt-4o-mini`)
4. Deploy.

Vercel se doc `vercel.json`, tu dong chay `npm run build`, sau do route tat ca request vao `app.py`.

## 2. Chay local bang Flask

1. Cai dependencies Python:
   - `pip install -r requirements.txt`
2. Build frontend:
   - `npm install`
   - `npm run build`
3. Chay server:
   - `python app.py`
4. Mo `http://localhost:8000`.

## 3. Bien moi truong local

Copy `.env.example` thanh `.env` va dien gia tri that. Neu dung shell export truc tiep:

- `export OPENAI_API_KEY=...`
- `export OPENAI_MODEL=gpt-4o-mini`
