const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 讓 server 可以讀取 JSON
app.use(express.json());

// 網頁放在 public 資料夾
app.use(express.static('public'));

let globalState = {};

// ===============================
// 登入帳號
// 密碼不寫在 HTML
// 改從 Render Environment Variables 讀取
// ===============================

const validAccounts = {
    "1001": process.env.PASSWORD_1001,
    "1002": process.env.PASSWORD_1002,
    "1003": process.env.PASSWORD_1003
};

// ===============================
// 登入 API
// ===============================

app.post('/api/login', (req, res) => {

    const { username, password } = req.body;

    if (
        validAccounts[username] &&
        validAccounts[username] === password
    ) {

        return res.json({
            success: true
        });

    }

    return res.status(401).json({
        success: false
    });
});

// ===============================
// Socket.IO
// ===============================

io.on('connection', (socket) => {

    console.log('有人連線');

    socket.emit('init_data', globalState);

    socket.on('tank_changed', (data) => {

        const { tankNo } = data;

        globalState[tankNo] = data;

        socket.broadcast.emit('sync_tank', data);

    });

    socket.on('disconnect', () => {
        console.log('有人離線');
    });

});

// ===============================
// 啟動 Server
// ===============================

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 雲端伺服器啟動！Port: ${PORT}`);
});
