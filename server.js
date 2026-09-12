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
// 初始化資料庫
// =====================================================

async function initDatabase() {

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


    await pool.query(`
        CREATE TABLE IF NOT EXISTS tank_history (
            id BIGSERIAL PRIMARY KEY,
            tank_no VARCHAR(20) NOT NULL,
            old_level NUMERIC,
            new_level NUMERIC,
            old_vendors JSONB NOT NULL DEFAULT '[]'::jsonb,
            new_vendors JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_by VARCHAR(50) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);


    console.log(
        '✅ PostgreSQL tank_state 資料表已就緒'
    );

    console.log(
        '✅ PostgreSQL tank_history 資料表已就緒'
    );
}


// =====================================================
// API JWT 驗證
// =====================================================

function verifyApiToken(
    req,
    res,
    next
) {

    const authHeader =
        req.headers.authorization;


    if (
        !authHeader ||
        !authHeader.startsWith('Bearer ')
    ) {

        return res
            .status(401)
            .json({
                success: false,
                message: '未登入'
            });
    }


    const token =
        authHeader.substring(7);


    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );


        req.user =
            decoded;


        next();

    } catch (error) {

        return res
            .status(401)
            .json({
                success: false,
                message: '登入已失效'
            });
    }
}


// =====================================================
// 讀取所有桶槽狀態
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

            tankNo:
                row.tank_no,

            level:
                Number(row.level),

            vendors:
                Array.isArray(
                    row.vendors
                )
                    ? row.vendors
                    : [],

            timeStr:
                row.time_str || ""

        };
    });


    return state;
}


// =====================================================
// 讀取單一桶槽
// =====================================================

async function getTankState(
    tankNo
) {

    const result =
        await pool.query(
            `
            SELECT
                level,
                vendors
            FROM tank_state
            WHERE tank_no = $1
            `,
            [
                tankNo
            ]
        );


    if (
        result.rows.length === 0
    ) {

        return {
            level: 0,
            vendors: []
        };
    }


    return {

        level:
            Number(
                result.rows[0].level
            ),

        vendors:
            Array.isArray(
                result.rows[0].vendors
            )
                ? result.rows[0].vendors
                : []

    };
}


// =====================================================
// 儲存目前狀態
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
            JSON.stringify(
                vendors || []
            ),
            timeStr || "",
            username
        ]
    );
}


// =====================================================
// 儲存歷史紀錄
// =====================================================

async function saveTankHistory(
    tankNo,
    oldState,
    newState,
    username
) {

    await pool.query(
        `
        INSERT INTO tank_history (
            tank_no,
            old_level,
            new_level,
            old_vendors,
            new_vendors,
            updated_by,
            updated_at
        )

        VALUES (
            $1,
            $2,
            $3,
            $4::jsonb,
            $5::jsonb,
            $6,
            NOW()
        )
        `,
        [
            tankNo,

            oldState.level,

            newState.level,

            JSON.stringify(
                oldState.vendors || []
            ),

            JSON.stringify(
                newState.vendors || []
            ),

            username
        ]
    );
}


// =====================================================
// Login API
// =====================================================

app.post(
    '/api/login',
    (req, res) => {

        const {
            username,
            password
        } = req.body;


        if (
            validAccounts[username] &&
            validAccounts[username] === password
        ) {

            const token =
                jwt.sign(
                    {
                        username:
                            username
                    },
                    JWT_SECRET,
                    {
                        expiresIn:
                            '8h'
                    }
                );


            return res.json({
                success: true,
                token: token
            });
        }


        return res
            .status(401)
            .json({
                success: false
            });
    }
);


// =====================================================
// 歷史紀錄 API
// =====================================================

app.get(
    '/api/history',
    verifyApiToken,
    async (req, res) => {

        try {

            let limit =
                Number(
                    req.query.limit
                ) || 50;


            if (limit < 1) {
                limit = 1;
            }


            if (limit > 200) {
                limit = 200;
            }


            const tankNo =
                typeof req.query.tankNo ===
                'string'

                    ? req.query.tankNo.trim()

                    : "";


            let result;


            if (tankNo) {

                result =
                    await pool.query(
                        `
                        SELECT
                            id,
                            tank_no,
                            old_level,
                            new_level,
                            old_vendors,
                            new_vendors,
                            updated_by,
                            updated_at
                        FROM tank_history
                        WHERE tank_no = $1
                        ORDER BY updated_at DESC
                        LIMIT $2
                        `,
                        [
                            tankNo,
                            limit
                        ]
                    );

            } else {

                result =
                    await pool.query(
                        `
                        SELECT
                            id,
                            tank_no,
                            old_level,
                            new_level,
                            old_vendors,
                            new_vendors,
                            updated_by,
                            updated_at
                        FROM tank_history
                        ORDER BY updated_at DESC
                        LIMIT $1
                        `,
                        [
                            limit
                        ]
                    );
            }


            const history =
                result.rows.map(row => {

                    return {

                        id:
                            row.id,

                        tankNo:
                            row.tank_no,

                        oldLevel:
                            row.old_level === null
                                ? null
                                : Number(
                                    row.old_level
                                ),

                        newLevel:
                            row.new_level === null
                                ? null
                                : Number(
                                    row.new_level
                                ),

                        oldVendors:
                            Array.isArray(
                                row.old_vendors
                            )
                                ? row.old_vendors
                                : [],

                        newVendors:
                            Array.isArray(
                                row.new_vendors
                            )
                                ? row.new_vendors
                                : [],

                        updatedBy:
                            row.updated_by,

                        updatedAt:
                            row.updated_at

                    };

                });


            return res.json({
                success: true,
                history: history
            });


        } catch (error) {

            console.error(
                '❌ 讀取歷史紀錄失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '讀取歷史紀錄失敗'
                });
        }
    }
);


// =====================================================
// Socket JWT 驗證
// =====================================================

io.use(
    (socket, next) => {

        const token =
            socket
                .handshake
                .auth
                .token;


        if (!token) {

            return next(
                new Error(
                    '未登入'
                )
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
                new Error(
                    '登入已失效'
                )
            );
        }
    }
);


// =====================================================
// Socket.IO
// =====================================================

io.on(
    'connection',
    async socket => {

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
            async data => {

                try {

                    const tankNo =
                        data.tankNo;


                    if (!tankNo) {
                        return;
                    }


                    const level =
                        Number(
                            data.level
                        );


                    if (
                        !Number.isFinite(
                            level
                        )
                    ) {
                        return;
                    }


                    if (
                        level < 0
                    ) {
                        return;
                    }


                    const vendors =
                        Array.isArray(
                            data.vendors
                        )
                            ? data.vendors
                            : [];


                    const timeStr =
                        typeof data.timeStr ===
                        'string'

                            ? data.timeStr

                            : "";


                    // 修改前狀態
                    const oldState =
                        await getTankState(
                            tankNo
                        );


                    const newState = {

                        level:
                            level,

                        vendors:
                            vendors

                    };


                    // 儲存目前狀態
                    await saveTankState(
                        {

                            tankNo:
                                tankNo,

                            level:
                                level,

                            vendors:
                                vendors,

                            timeStr:
                                timeStr

                        },

                        socket.user.username
                    );


                    // 儲存歷史
                    await saveTankHistory(

                        tankNo,

                        oldState,

                        newState,

                        socket.user.username
                    );


                    console.log(
                        `📝 ${socket.user.username} 修改 ${tankNo}：${oldState.level} → ${level}`
                    );


                    socket.broadcast.emit(
                        'sync_tank',
                        {

                            tankNo:
                                tankNo,

                            level:
                                level,

                            vendors:
                                vendors,

                            timeStr:
                                timeStr

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
    }
);


// =====================================================
// 啟動 Server
// =====================================================

const PORT =
    process.env.PORT ||
    3000;


async function startServer() {

    try {

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


    } catch (error) {

        console.error(
            '❌ Server 啟動失敗:',
            error
        );


        process.exit(1);
    }
}


startServer();
