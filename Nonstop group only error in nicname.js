const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const http = require('http');

const app = express();
const server = http.createServer(app);

// === GLOBAL STATE ===
let sessions = {}; // taskId -> { api, config, logs, isRunning, lockedGroups, lockedNicknames }

// Error Handling
process.on('uncaughtException', (err) => {
    console.error(`[CRITICAL ERROR] ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
    console.error(`[UNHANDLED REJECTION] ${reason}`);
});

function addLog(taskId, message, type = 'info') {
    if (!sessions[taskId]) return;
    const logEntry = {
        timestamp: new Date().toLocaleTimeString(),
        message,
        type
    };
    sessions[taskId].logs.push(logEntry);
    if (sessions[taskId].logs.length > 100) sessions[taskId].logs.shift();
    console.log(`[${taskId}] [${type.toUpperCase()}] ${message}`);
}

const mastiReplies = [
  "TER1 BEHEN K1 CHOOT KO MUJHE CHODNE ME B4D4 M4Z4 4RH4 H41 BEHENCHOD KE D1NNE K1N4R K1 4UL44D HEHEHEHEH <3😆",
  "TER1 TER1 BEHEN K1 CHOOT TO K4L4P K4L4P KE LOWD4 CHUSE J44 RH1 H41 HEN HEN BEHENCHOD KE D1NNE =]]😂",
  "44J4 BEHCOD KE LOWDE TER1 BEHEN K1 CHOOT KO M41 CHOD J4UNG4 LOWDE KE B44L R4ND1 KE D1NNE =]]😎",
  "TER1 BEHEN K1 CHOOT =]] F4T1 J44 RH1 H41 BHOSD KE B| TER1 BEHEN K1 CHOOT 1TN4 K4L4P K1YO RH1 H41 REEE R4ND1 KE B4CHEW =]]😜",
  "TER1 BEHEN KE BHOSDE ME M41 LOWD4 D44L KR TER1 BEHEN K1 CHOOT KO M41 CHOD J4UNG4 LOWDE KE B4CHEW 44J4 BEHCOD KE LOWDE =]]🤣",
  "TER1 B44J1 K1 CHOOT ME M41 SUNEH4R1 LOWDE KE 4T4KDEER L4G4 DUNG4 R44ND KE B4CHEW K1 TER1 BEHEN K1 BOOR K4PTE T4B4H1G1 LOWDE <3🔥",
  "TER1 BEHEN K1 CHOOT KO M41 CHOD M4RU BEHENCHOD KE LOWDE R4ND1 KE D1NNE =]]💕",
  "TER1 BEHEN K1 G44ND ME M41 LOWD4 M4RUNG4 BHOSD CHOD KE 4UL44D S4LE G4NDE N44L1 KE G4NDE B4CHEW BHOSDKE =]]😏",
  "M41 TER1 M44 KO K41SE CHODT4 HUN 44J TUJHE Y44D D1L4 DUNG4 R444ND KE B4CHEW :v 44J M41 TUJHE RUL RUL4 KE CHODUNG4 BEHHNCHOD KE D1NNE :v😂",
  "MERE B4CHEW 44J4 MERE LOWDE _||_ PE JHOOM M4THERCHOD KE GH4ST1 KE B4CHEW <3 TER1 BEHEN K1 CHOOT ME M41 B4ST1 B4S4 DU :v🤭",
  "4J4 =]] REG1ST44N KE D1NNE TER1 BEHEN K1 G44ND M4RU LOWDE KE D1NNE B|😁",
  "R4ND1 1NSH44N KE R4ND1 B4CHEW TER1 BEHEN K1 CHOOT KO M41 CHODTE J4UNG4 LOWDE KE D1NNE TER1 BEHEN K1 G44ND KO M41 CHEER J4U =]] 😘"
];

// Human behavior delay helpers
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

function startBot(taskId) {
    const session = sessions[taskId];
    if (!session || session.isRunning) return;
    
    addLog(taskId, "Launching Bot Session...");
    let appState;
    try {
        appState = JSON.parse(session.config.appState);
    } catch (e) {
        addLog(taskId, "Invalid AppState JSON", "error");
        delete sessions[taskId];
        return;
    }

    // Tracker for human behavior cooldowns
    const cooldowns = {
        name: {}, // threadID -> expiry
        nick: {}, // threadID -> expiry
        msg: {}   // threadID -> expiry
    };

    login({ appState }, (err, api) => {
        if (err) {
            addLog(taskId, `Login failed: ${err.message || err}`, "error");
            session.isRunning = false;
            return;
        }

        session.api = api;
        session.isRunning = true;
        addLog(taskId, "Bot logged in successfully!");

        api.setOptions({ listenEvents: true, selfListen: true, forceLogin: true, online: true });

        api.listenMqtt(async (err, event) => {
            if (err) {
                addLog(taskId, `Listener error: ${err}`, "error");
                return;
            }

            try {
                const threadID = event.threadID;
                const now = Date.now();
                const botID = api.getCurrentUserID();

                // Anti-Out (Instant Re-add)
                if (event.logMessageType === "log:unsubscribe") {
                    const leftUserId = event.logMessageData.leftParticipantFbId;
                    if (leftUserId !== botID) {
                        api.addUserToGroup(leftUserId, threadID);
                    }
                }

                // Group Name Lock (Batch Behavior like Nickname)
                if (event.logMessageType === "log:thread-name") {
                    const lockedName = session.lockedGroups[threadID];
                    if (lockedName && event.logMessageData.name !== lockedName) {
                        if (cooldowns.name[threadID] && now < cooldowns.name[threadID]) return;
                        
                        addLog(taskId, `Name Change Detected. Reverting with delay...`, "warn");
                        cooldowns.name[threadID] = now + randomRange(6000, 10000); // 6-10s cooldown
                        
                        setTimeout(async () => {
                            await sleep(randomRange(3000, 5000)); // 3-5s delay
                            api.setTitle(lockedName, threadID);
                        }, 100);
                    }
                }

                // Nickname Lock (Human Behavior)
                if (event.logMessageType === "log:user-nickname") {
                    const lockedNick = session.lockedNicknames[threadID];
                    if (lockedNick && event.logMessageData.nickname !== lockedNick) {
                        if (cooldowns.nick[threadID] && now < cooldowns.nick[threadID]) return;

                        const pid = event.logMessageData.participant_id;
                        addLog(taskId, `Nick Change Detected. Reverting with delay...`, "warn");
                        cooldowns.nick[threadID] = now + randomRange(6000, 10000); // 6-10s cooldown

                        setTimeout(async () => {
                            await sleep(randomRange(3000, 5000)); // 3-5s delay
                            api.changeNickname(lockedNick, threadID, pid);
                        }, 100);
                    }
                }

                if (event.type === "message" || event.type === "message_reply") {
                    const { senderID, body } = event;
                    if (!body) return;

                    const prefix = session.config.prefix;
                    const isCommand = body.startsWith(prefix);
                    const isAdmin = senderID === session.config.adminId;

                    if (senderID === botID) return;

                    if (isCommand && isAdmin) {
                        const args = body.slice(prefix.length).trim().split(/ +/);
                        const command = args.shift().toLowerCase();

                        if (command === 'lockgroup') {
                            const name = args.join(' ').trim();
                            if (name) {
                                session.lockedGroups[threadID] = name;
                                api.setTitle(name, threadID);
                                api.sendMessage(`✅ Group name locked. Revert delay (3-5s).`, threadID);
                            }
                        } else if (command === 'locknick') {
                            const nick = args.join(' ').trim();
                            if (nick) {
                                session.lockedNicknames[threadID] = nick;
                                api.sendMessage(`✅ Nickname lock starting (Batch process)...`, threadID);
                                
                                api.getThreadInfo(threadID, async (err, info) => {
                                    if (info) {
                                        const pids = info.participantIDs;
                                        for (let i = 0; i < pids.length; i++) {
                                            api.changeNickname(nick, threadID, pids[i]);
                                            if ((i + 1) % 20 === 0) { // Batch of 20
                                                addLog(taskId, `Nickname Batch completed. Pause 30s...`, "info");
                                                await sleep(randomRange(20000, 30000)); 
                                            }
                                        }
                                        api.sendMessage(`✅ All nicknames locked. Revert delay (3-5s).`, threadID);
                                    }
                                });
                            }
                        } else if (command === 'unlockgroup') {
                            delete session.lockedGroups[threadID];
                            api.sendMessage(`🔓 Group name unlocked.`, threadID);
                        } else if (command === 'unlocknick') {
                            delete session.lockedNicknames[threadID];
                            api.sendMessage(`🔓 Nickname lock removed.`, threadID);
                        }
                    } else if (!isCommand) {
                        // Only reply in groups where a lock is active
                        if (!session.lockedGroups[threadID] && !session.lockedNicknames[threadID]) return;

                        // Message Warning System (Human Behavior)
                        if (cooldowns.msg[threadID] && now < cooldowns.msg[threadID]) return;

                        const randomReply = mastiReplies[Math.floor(Math.random() * mastiReplies.length)];
                        api.sendMessage(randomReply, threadID, (err) => {
                            if (!err) {
                                cooldowns.msg[threadID] = now + 120000; // 120s cooldown after one reply
                                addLog(taskId, `Warning reply sent to ${threadID}. 120s pause.`, "info");
                            }
                        });
                    }
                }
            } catch (e) {
                addLog(taskId, `Handler error: ${e.message}`, "error");
            }
        });
    });
}

// === WEB ROUTES ===
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ROWEDY PREMIUM DASHBOARD</title>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root { --p: #00ffaa; --bg: #030303; --c: rgba(255,255,255,0.04); --b: rgba(255,255,255,0.1); }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { 
            font-family: 'Space Grotesk', sans-serif; 
            background: url('https://i.ibb.co/vCd29NJd/1751604135213.jpg') no-repeat center center fixed; 
            background-size: cover;
            color: #fff; 
            padding: 20px; 
            min-height: 100vh;
        }
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
            z-index: -1;
        }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1200px; margin: 0 auto; }
        @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
        .card { background: rgba(255,255,255,0.05); border: 1px solid var(--b); border-radius: 20px; padding: 25px; backdrop-filter: blur(15px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h1 { color: var(--p); font-size: 24px; margin-bottom: 20px; letter-spacing: 2px; text-transform: uppercase; border-bottom: 2px solid var(--p); display: inline-block; padding-bottom: 5px; }
        textarea, input { width: 100%; background: rgba(0,0,0,0.6); border: 1px solid var(--b); color: #fff; padding: 12px; border-radius: 12px; margin-bottom: 15px; font-family: inherit; transition: 0.3s; }
        textarea:focus, input:focus { border-color: var(--p); outline: none; background: rgba(0,0,0,0.8); }
        .btn { width: 100%; padding: 15px; border-radius: 12px; border: none; font-weight: 600; cursor: pointer; text-transform: uppercase; background: var(--p); color: #000; transition: 0.3s; margin-bottom: 10px; }
        .btn:hover { box-shadow: 0 0 25px var(--p); transform: translateY(-2px); }
        .btn-danger { background: #ff4444; color: #fff; margin-top: 10px; }
        .btn-danger:hover { box-shadow: 0 0 20px #ff4444; }
        .sessions { margin-top: 20px; }
        .session-item { background: rgba(0,0,0,0.6); padding: 15px; border-radius: 12px; margin-bottom: 10px; border-left: 4px solid var(--p); display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: 0.3s; }
        .session-item:hover { background: rgba(255,255,255,0.1); }
        .session-item.active { border-color: #0f8; background: rgba(0,255,170,0.1); }
        .console { background: rgba(0,0,0,0.8); height: 400px; overflow-y: auto; padding: 15px; border-radius: 15px; border: 1px solid var(--b); font-family: 'JetBrains Mono', monospace; font-size: 11px; }
        .log-info { color: var(--p); } .log-error { color: #ff4444; } .log-warn { color: #ffaa00; }
        .active-id { color: var(--p); font-weight: bold; background: rgba(0,255,170,0.1); padding: 2px 8px; border-radius: 4px; }
        .cmd-box { grid-column: 1/-1; }
        .cmd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .cmd { background: rgba(0,0,0,0.6); padding: 15px; border-radius: 12px; border: 1px solid var(--b); }
        .cmd span { color: var(--p); font-weight: 600; font-size: 14px; display: block; }
        .cmd p { font-size: 11px; color: #aaa; }
    </style>
</head>
<body>
    <div class="grid">
        <div class="card">
            <h1>LAUNCHER</h1>
            <div id="form">
                <textarea id="appState" rows="5" placeholder="Paste AppState JSON here..."></textarea>
                <input type="text" id="adminId" placeholder="Admin FB UID (Required)">
                <input type="text" id="prefix" value="/" placeholder="Prefix (Default: /)">
                <button class="btn" onclick="launch()">GENERATE TASK & START</button>
            </div>
            <div class="sessions" id="sessionList"></div>
        </div>
        <div class="card">
            <h1>CONSOLE <span id="currentTask" class="active-id">SELECT TASK</span></h1>
            <div class="console" id="console"></div>
            <button id="deleteBtn" class="btn btn-danger" style="display:none;" onclick="deleteTask()">REMOVE INACTIVE TASK</button>
        </div>
        <div class="card cmd-box">
            <h1>COMMANDS & FEATURES</h1>
            <div class="cmd-grid">
                <div class="cmd"><span>/lockgroup &lt;name&gt;</span><p>Locks group name. Revert delay (3-5s), Cooldown (6-10s).</p></div>
                <div class="cmd"><span>/locknick &lt;nick&gt;</span><p>Locks nicknames for ALL members. Revert delay (3-5s), Cooldown (6-10s).</p></div>
                <div class="cmd"><span>/unlockgroup</span><p>Remove group name lock from current chat.</p></div>
                <div class="cmd"><span>/unlocknick</span><p>Remove nickname lock from current chat.</p></div>
                <div class="cmd"><span>Anti-Out</span><p>Auto-adds users who leave or get kicked.</p></div>
                <div class="cmd"><span>Human Behavior</span><p>Cooldowns optimized to avoid blocks.</p></div>
            </div>
        </div>
    </div>
    <script>
        let selectedTaskId = null;
        function launch() {
            const appState = document.getElementById('appState').value;
            const adminId = document.getElementById('adminId').value;
            if(!appState || !adminId) return alert('AppState and Admin ID are required!');
            
            const data = { appState, adminId, prefix: document.getElementById('prefix').value };
            fetch('/api/create', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            }).then(r => r.json()).then(res => {
                selectedTaskId = res.taskId;
                document.getElementById('appState').value = '';
                updateSessions();
            });
        }
        function updateSessions() {
            fetch('/api/sessions').then(r => r.json()).then(data => {
                document.getElementById('sessionList').innerHTML = data.map(s => \`
                    <div class="session-item \${selectedTaskId === s.id ? 'active' : ''}" onclick="selectTask('\${s.id}')">
                        <span>TASK: \${s.id}</span>
                        <span style="color:\${s.active?'#0f8':'#ff4444'}">\${s.active?'ACTIVE':'IDLE'}</span>
                    </div>
                \`).join('');
            });
        }
        function selectTask(id) {
            selectedTaskId = id;
            document.getElementById('currentTask').innerText = id;
            updateLogs();
            updateSessions();
        }
        function deleteTask() {
            if(!selectedTaskId) return;
            fetch('/api/delete/' + selectedTaskId, { method: 'POST' }).then(() => {
                selectedTaskId = null;
                document.getElementById('currentTask').innerText = 'SELECT TASK';
                document.getElementById('console').innerHTML = '';
                document.getElementById('deleteBtn').style.display = 'none';
                updateSessions();
            });
        }
        function updateLogs() {
            if(!selectedTaskId) return;
            fetch('/api/logs/' + selectedTaskId).then(r => r.json()).then(res => {
                if(res.error) {
                    selectedTaskId = null;
                    return;
                }
                const div = document.getElementById('console');
                div.innerHTML = res.logs.map(l => \`<div class="log-\${l.type}">[\${l.timestamp}] \${l.message}</div>\`).join('');
                div.scrollTop = div.scrollHeight;
                document.getElementById('deleteBtn').style.display = !res.active ? 'block' : 'none';
            });
        }
        setInterval(() => {
            updateSessions();
            if(selectedTaskId) updateLogs();
        }, 3000);
        updateSessions();
    </script>
</body>
</html>
    `);
});

app.post('/api/create', (req, res) => {
    const taskId = 'TASK-' + Math.random().toString(36).substring(7).toUpperCase();
    sessions[taskId] = {
        config: req.body,
        logs: [],
        isRunning: false,
        api: null,
        lockedGroups: {},
        lockedNicknames: {},
        lastMessageTime: {}
    };
    startBot(taskId);
    res.json({ taskId });
});

app.post('/api/delete/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    if (sessions[taskId]) {
        if (sessions[taskId].api) {
            try { sessions[taskId].api.stopListening(); } catch(e) {}
        }
        delete sessions[taskId];
    }
    res.json({ success: true });
});

app.get('/api/sessions', (req, res) => {
    res.json(Object.keys(sessions).map(id => ({ id, active: sessions[id].isRunning })));
});

app.get('/api/logs/:taskId', (req, res) => {
    const session = sessions[req.params.taskId];
    if (!session) return res.json({ error: 'Not found' });
    res.json({ logs: session.logs, active: session.isRunning });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Locker Bot System active on port ${PORT}`);
});
