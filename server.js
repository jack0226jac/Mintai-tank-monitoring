const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

const validAccounts = {
    "1001": process.env.PASSWORD_1001,
    "1002": process.env.PASSWORD_1002,
    "1003": process.env.PASSWORD_1003
};


// =====================================================
// PostgreSQL
// =====================================================

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});


// =====================================================
// 建立資料表
// =====================================================

async function initDatabase() {

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tank_state (
                tank_no VARCHAR(20) PRIMARY KEY,
                level NUMERIC NOT NULL DEFAULT 0,
                vendors JSONB NOT NULL DEFAULT '[]'::jsonb,
                time_str VARCHAR(100),
                updated_by VARCHAR(50),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        console.log('✅ PostgreSQL tank_state 資料表已就緒');

    } catch (error) {

        console.error(
            '❌ PostgreSQL 初始化失敗:',
            error
        );

    }

}


// =====================================================
// 從 PostgreSQL 讀取全部桶槽狀態
// =====================================================

async function loadAllTankStates() {

    const result =
        await pool.query(`
            SELECT
                tank_no,
                level,
                vendors,
                time_str,
                updated_by,
                updated_at
            FROM tank_state
            ORDER BY tank_no
        `);

    const state = {};

    result.rows.forEach(row => {

        state[row.tank_no] = {
            tankNo: row.tank_no,
            level: Number(row.level),
            vendors: row.vendors || [],
            timeStr: row.time_str || ""
        };

    });

    return state;

}


// =====================================================
// 儲存桶槽狀態
// =====================================================

async function saveTankState(
    data,
    username
) {

    const {
        tankNo,
        level,
        vendors,
        timeStr
    } = data;

    await pool.query(
        `
        INSERT INTO tank_state (
            tank_no,
            level,
            vendors,
            time_str,
            updated_by,
            updated_at
        )

        VALUES (
            $1,
            $2,
            $3::jsonb,
            $4,
            $5,
            NOW()
        )

        ON CONFLICT (tank_no)

        DO UPDATE SET
            level = EXCLUDED.level,
            vendors = EXCLUDED.vendors,
            time_str = EXCLUDED.time_str,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        `,
        [
            tankNo,
            level,
            JSON.stringify(vendors || []),
            timeStr || "",
            username
        ]
    );

}


// =====================================================
// Login
// =====================================================

app.post('/api/login', (req, res) => {

    const {
        username,
        password
    } = req.body;

    if (
        validAccounts[username] &&
        validAccounts[username] === password
    ) {

        const token = jwt.sign(
            {
                username: username
            },
            JWT_SECRET,
            {
                expiresIn: '8h'
            }
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


// =====================================================
// Socket JWT 驗證
// =====================================================

io.use((socket, next) => {

    const token =
        socket.handshake.auth.token;

    if (!token) {

        return next(
            new Error('未登入')
        );

    }

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        socket.user =
            decoded;

        next();

    } catch (error) {

        return next(
            new Error('登入已失效')
        );

    }

});


// =====================================================
// Socket.IO
// =====================================================

io.on('connection', async (socket) => {

    console.log(
        `✅ ${socket.user.username} 已連線`
    );


    try {

        const globalState =
            await loadAllTankStates();

        socket.emit(
            'init_data',
            globalState
        );

    } catch (error) {

        console.error(
            '❌ 讀取桶槽資料失敗:',
            error
        );

    }


    socket.on(
        'tank_changed',
        async (data) => {

            try {

                const {
                    tankNo,
                    level
                } = data;


                if (!tankNo) {

                    return;

                }


                if (
                    level === undefined ||
                    level === null ||
                    Number.isNaN(
                        Number(level)
                    )
                ) {

                    return;

                }


                await saveTankState(
                    {
                        tankNo:
                            tankNo,

                        level:
                            Number(level),

                        vendors:
                            Array.isArray(
                                data.vendors
                            )
                                ? data.vendors
                                : [],

                        timeStr:
                            data.timeStr || ""
                    },
                    socket.user.username
                );


                console.log(
                    `📝 ${socket.user.username} 修改 ${tankNo}：${level}`
                );


                socket.broadcast.emit(
                    'sync_tank',
                    {
                        tankNo:
                            tankNo,

                        level:
                            Number(level),

                        vendors:
                            Array.isArray(
                                data.vendors
                            )
                                ? data.vendors
                                : [],

                        timeStr:
                            data.timeStr || ""
                    }
                );


            } catch (error) {

                console.error(
                    '❌ 儲存桶槽資料失敗:',
                    error
                );

            }

        }
    );


    socket.on(
        'disconnect',
        () => {

            console.log(
                `❌ ${socket.user.username} 已離線`
            );

        }
    );

});


// =====================================================
// 啟動 Server
// =====================================================

const PORT =
    process.env.PORT ||
    3000;


async function startServer() {

    await initDatabase();

    server.listen(
        PORT,
        '0.0.0.0',
        () => {

            console.log(
                `🚀 雲端伺服器啟動！Port: ${PORT}`
            );

        }
    );

}


startServer();
