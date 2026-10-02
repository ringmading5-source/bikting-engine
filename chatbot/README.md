# B-STAE Chatbot

This is the chatbot's dedicated folder. `index.html` is the chat interface;
`run.py` launches it using the B-STAE engine and chatbot logic in `../b-stae`.

From the repository root:

```bash
python chatbot/run.py
```

Open **http://127.0.0.1:8765/**. The chatbot opens directly at the homepage.
The engine workspace is at `/workspace`; the media teaching page is at `/learn`.
Conversation history and taught replies are stored in `chatbot/data/chat.sqlite3`.
Use `--db` to select an existing B-STAE database or another storage location.
Greet it with “hello”, teach an exact reply, or load the sample relationship lesson.
It does not yet answer arbitrary questions or transcribe speech automatically.

For hosting, start with `python chatbot/run.py --host 0.0.0.0` and set
`BSTAE_ACCESS_TOKEN` to at least 16 characters. Set `RENDER_EXTERNAL_HOSTNAME`
when hosting on Render (Render supplies it automatically). Configure
`BSTAE_DB_PATH` on persistent storage if history must survive redeployments.
The repository's root `render.yaml` runs the separate Node app; deploying that
service does not automatically start this Python chatbot.

For image/audio teaching, install extras from `b-stae`:
`python -m pip install "./b-stae[media]"` from the repository root.
