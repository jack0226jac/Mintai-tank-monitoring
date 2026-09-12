const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

let globalState = {};

const JWT_SECRET = process.env.JWT_SECRET;

const validAccounts = {
    "1001": process.env.PASSWORD_1001,
    "1002": process.env.PASSWORD_1002,
    "1003": process.env.PASSWORD_1003
};

// ========================================
// 登入 API
// ========================================

app.post('/api/login', (req, res) => {

    const { username, password } = req.body;

    if (
        validAccounts[username] &&
        validAccounts[username] === password
    ) {

        // 登入成功後產生 8小時有效的通行證
        const token = jwt.sign(
            { username: username },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({
            success: true,
            token: token
        });
    }

    return res.status(401).json({
        success: false
    });
});


// ========================================
// Socket.IO 登入驗證
// ========================================

io.use((socket, next) => {

    const token = socket.handshake.auth.token;

    if (!token) {
        return next(new Error('未登入'));
    }

    try {

        const decoded = jwt.verify(token, JWT_SECRET);

        socket.user = decoded;

        next();

    } catch (error) {

        return next(new Error('登入已失效'));

    }
});


// ========================================
// Socket.IO
// ========================================

io.on('connection', (socket) => {

    console.log(`✅ ${socket.user.username} 已連線`);

    socket.emit('init_data', globalState);

    socket.on('tank_changed', (data) => {

        const { tankNo } = data;

        if (!tankNo) {
            return;
        }

        globalState[tankNo] = data;

        console.log(
            `📝 ${socket.user.username} 修改 ${tankNo}`
        );

        socket.broadcast.emit('sync_tank', data);

    });

    socket.on('disconnect', () => {

        console.log(
            `❌ ${socket.user.username} 已離線`
        );

    });

});


// ========================================
// 啟動 Server
// ========================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {

    console.log(`🚀 雲端伺服器啟動！Port: ${PORT}`);

});
