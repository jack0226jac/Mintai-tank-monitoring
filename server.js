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


// =====================================================
// 帳號
// =====================================================

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
// 初始桶槽資料
// 只在資料庫沒有該桶號時新增，不會覆蓋既有設定
// =====================================================

const INITIAL_TANKS = [
    ["TK-01", "液鹼 (45%)", 60, "液鹼", 1],
    ["TK-02", "液鹼 (45%)", 60, "液鹼", 2],
    ["TK-37", "液鹼45%", 60, "液鹼", 3],
    ["TK-45", "液鹼45%", 30, "液鹼", 4],

    ["TK-06", "鹽酸 (32%)", 60, "鹽酸", 5],
    ["TK-07", "鹽酸 (32%)", 60, "鹽酸", 6],
    ["TK-08", "鹽酸 (32%)", 60, "鹽酸", 7],
    ["TK-09", "鹽酸 (32%)", 60, "鹽酸", 8],
    ["TK-13", "鹽酸 (HCl)", 90, "鹽酸", 9],

    ["TK-12", "純水", 90, "其它", 10],

    ["TK-10", "硝酸 (40%)", 80, "硝酸", 11],
    ["TK-41", "硝酸 (55%)", 30, "硝酸", 12],
    ["TK-42", "硝酸 (50%)", 30, "硝酸", 13],

    ["TK-03", "硫酸 (50%)", 60, "硫酸", 14],
    ["TK-05", "硫酸 (50%)", 60, "硫酸", 15],
    ["TK-11", "硫酸 (50%)", 80, "硫酸", 16],
    ["TK-16", "硫酸 (50%)", 90, "硫酸", 17],
    ["TK-39", "BM硫酸 (60%)", 60, "硫酸", 18],
    ["TK-40", "硫酸 (98%)", 60, "硫酸", 19],

    ["TK-38", "氯化鐵", 60, "其它", 20],
    ["TK-15", "碳酸鈉", 60, "其它", 21]
];


// =====================================================
// 初始廠商資料
// =====================================================

const INITIAL_VENDORS = [
    ["台塑食", 1],
    ["台塑工", 2],
    ["東南", 3],
    ["中華化學", 4],
    ["華夏", 5],
    ["台紙", 6],
    ["義芳", 7],
    ["合禮", 8],
    ["貝民", 9],
    ["西一", 10],
    ["進口", 11],
    ["晴揚", 12],
    ["元成", 13],
    ["其他", 14]
];


// =====================================================
// 初始化資料庫
// =====================================================

async function initDatabase() {

    // -----------------------------
    // 現有桶槽狀態
    // -----------------------------

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


    // -----------------------------
    // 現有操作歷史
    // -----------------------------

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


    // -----------------------------
    // 桶槽主檔
    // -----------------------------

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tank_master (
            tank_no VARCHAR(20) PRIMARY KEY,
            product VARCHAR(100) NOT NULL,
            max_level NUMERIC NOT NULL,
            category VARCHAR(50) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);


    // -----------------------------
    // 廠商主檔
    // -----------------------------

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendor_master (
            id BIGSERIAL PRIMARY KEY,
            vendor_name VARCHAR(100) UNIQUE NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);


    // -----------------------------
    // 匯入初始桶槽
    // -----------------------------

    for (const tank of INITIAL_TANKS) {

        const [
            tankNo,
            product,
            maxLevel,
            category,
            sortOrder
        ] = tank;


        await pool.query(
            `
            INSERT INTO tank_master (
                tank_no,
                product,
                max_level,
                category,
                sort_order,
                enabled
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                TRUE
            )
            ON CONFLICT (tank_no)
            DO NOTHING
            `,
            [
                tankNo,
                product,
                maxLevel,
                category,
                sortOrder
            ]
        );
    }


    // -----------------------------
    // 匯入初始廠商
    // -----------------------------

    for (const vendor of INITIAL_VENDORS) {

        const [
            vendorName,
            sortOrder
        ] = vendor;


        await pool.query(
            `
            INSERT INTO vendor_master (
                vendor_name,
                sort_order,
                enabled
            )
            VALUES (
                $1,
                $2,
                TRUE
            )
            ON CONFLICT (vendor_name)
            DO NOTHING
            `,
            [
                vendorName,
                sortOrder
            ]
        );
    }


    console.log('✅ PostgreSQL tank_state 資料表已就緒');
    console.log('✅ PostgreSQL tank_history 資料表已就緒');
    console.log('✅ PostgreSQL tank_master 資料表已就緒');
    console.log('✅ PostgreSQL vendor_master 資料表已就緒');
}


// =====================================================
// API JWT 驗證
// =====================================================

function verifyApiToken(req, res, next) {

    const authHeader =
        req.headers.authorization;


    if (
        !authHeader ||
        !authHeader.startsWith('Bearer ')
    ) {

        return res.status(401).json({
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

        return res.status(401).json({
            success: false,
            message: '登入已失效'
        });

    }

}


// =====================================================
// Server 台灣時間
// =====================================================

function getTaipeiTimeString() {

    return new Intl.DateTimeFormat(
        'zh-TW',
        {
            timeZone: 'Asia/Taipei',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }
    ).format(new Date());

}


// =====================================================
// 讀取啟用中的桶槽設定
// =====================================================

async function loadTankMaster() {

    const result =
        await pool.query(`
            SELECT
                tank_no,
                product,
                max_level,
                category,
                sort_order
            FROM tank_master
            WHERE enabled = TRUE
            ORDER BY
                sort_order ASC,
                tank_no ASC
        `);


    return result.rows.map(row => ({
        tankNo: row.tank_no,
        product: row.product,
        maxLevel: Number(row.max_level),
        category: row.category,
        sortOrder: row.sort_order
    }));

}


// =====================================================
// 讀取啟用中的廠商
// =====================================================

async function loadVendorMaster() {

    const result =
        await pool.query(`
            SELECT
                id,
                vendor_name,
                sort_order
            FROM vendor_master
            WHERE enabled = TRUE
            ORDER BY
                sort_order ASC,
                vendor_name ASC
        `);


    return result.rows.map(row => ({
        id: row.id,
        vendorName: row.vendor_name,
        sortOrder: row.sort_order
    }));

}


// =====================================================
// 檢查桶槽是否存在且啟用
// =====================================================

async function getActiveTank(tankNo) {

    const result =
        await pool.query(
            `
            SELECT
                tank_no,
                product,
                max_level,
                category
            FROM tank_master
            WHERE
                tank_no = $1
                AND enabled = TRUE
            `,
            [tankNo]
        );


    if (
        result.rows.length === 0
    ) {
        return null;
    }


    return {
        tankNo: result.rows[0].tank_no,
        product: result.rows[0].product,
        maxLevel: Number(result.rows[0].max_level),
        category: result.rows[0].category
    };

}


// =====================================================
// 檢查廠商是否存在且啟用
// 注意：允許同一天重複同一廠商
// =====================================================

async function validateVendors(vendors) {

    if (
        !Array.isArray(vendors)
    ) {
        return {
            success: false,
            message: '廠商資料格式錯誤'
        };
    }


    const cleanedVendors = [];


    for (const vendor of vendors) {

        if (
            typeof vendor !== 'string'
        ) {
            return {
                success: false,
                message: '廠商資料格式錯誤'
            };
        }


        const vendorName =
            vendor.trim();


        const result =
            await pool.query(
                `
                SELECT vendor_name
                FROM vendor_master
                WHERE
                    vendor_name = $1
                    AND enabled = TRUE
                `,
                [vendorName]
            );


        if (
            result.rows.length === 0
        ) {

            return {
                success: false,
                message: `廠商不存在或已停用：${vendorName}`
            };

        }


        // 刻意不去重
        // 同一個廠商可以一天出現很多次
        cleanedVendors.push(
            vendorName
        );

    }


    return {
        success: true,
        vendors: cleanedVendors
    };

}


// =====================================================
// 讀取全部目前桶槽狀態
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
            vendors:
                Array.isArray(row.vendors)
                    ? row.vendors
                    : [],
            timeStr:
                row.time_str || ""
        };

    });


    return state;

}


// =====================================================
// 陣列比較
// 這裡保留順序與重複項目
// =====================================================

function arraysEqual(a, b) {

    if (
        a.length !== b.length
    ) {
        return false;
    }


    for (
        let i = 0;
        i < a.length;
        i++
    ) {

        if (
            a[i] !== b[i]
        ) {
            return false;
        }

    }


    return true;

}


// =====================================================
// Login
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

    }
);


// =====================================================
// 新增：前端設定 API
// 取得桶槽主檔 + 廠商主檔
// =====================================================

app.get(
    '/api/config',
    verifyApiToken,
    async (req, res) => {

        try {

            const tanks =
                await loadTankMaster();


            const vendors =
                await loadVendorMaster();


            return res.json({
                success: true,
                tanks: tanks,
                vendors: vendors
            });


        } catch (error) {

            console.error(
                '❌ 讀取系統設定失敗:',
                error
            );


            return res.status(500).json({
                success: false,
                message: '讀取系統設定失敗'
            });

        }

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
                Number(req.query.limit) ||
                50;


            if (limit < 1) {
                limit = 1;
            }


            if (limit > 200) {
                limit = 200;
            }


            const tankNo =
                typeof req.query.tankNo === 'string'
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
                        ORDER BY
                            updated_at DESC,
                            id DESC
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
                        ORDER BY
                            updated_at DESC,
                            id DESC
                        LIMIT $1
                        `,
                        [
                            limit
                        ]
                    );

            }


            const history =
                result.rows.map(row => ({
                    id: row.id,
                    tankNo: row.tank_no,

                    oldLevel:
                        row.old_level === null
                            ? null
                            : Number(row.old_level),

                    newLevel:
                        row.new_level === null
                            ? null
                            : Number(row.new_level),

                    oldVendors:
                        Array.isArray(row.old_vendors)
                            ? row.old_vendors
                            : [],

                    newVendors:
                        Array.isArray(row.new_vendors)
                            ? row.new_vendors
                            : [],

                    updatedBy:
                        row.updated_by,

                    updatedAt:
                        row.updated_at
                }));


            return res.json({
                success: true,
                history: history
            });


        } catch (error) {

            console.error(
                '❌ 讀取歷史紀錄失敗:',
                error
            );


            return res.status(500).json({
                success: false,
                message: '讀取歷史紀錄失敗'
            });

        }

    }
);


// =====================================================
// Socket JWT
// =====================================================

io.use(
    (socket, next) => {

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


        // -----------------------------
        // 送目前桶槽資料
        // -----------------------------

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


        // -----------------------------
        // 桶槽修改
        // -----------------------------

        socket.on(
            'tank_changed',
            async data => {

                try {

                    const tankNo =
                        typeof data.tankNo === 'string'
                            ? data.tankNo.trim()
                            : "";


                    // -------------------------
                    // 桶槽驗證
                    // -------------------------

                    const tank =
                        await getActiveTank(
                            tankNo
                        );


                    if (!tank) {

                        socket.emit(
                            'tank_error',
                            {
                                message:
                                    `桶槽不存在或已停用：${tankNo}`
                            }
                        );

                        return;
                    }


                    // -------------------------
                    // 液位驗證
                    // -------------------------

                    const level =
                        Number(data.level);


                    if (
                        !Number.isFinite(level)
                    ) {

                        socket.emit(
                            'tank_error',
                            {
                                message:
                                    '液位格式錯誤'
                            }
                        );

                        return;
                    }


                    if (
                        level < 0
                    ) {

                        socket.emit(
                            'tank_error',
                            {
                                message:
                                    '液位不可小於 0'
                            }
                        );

                        return;
                    }


                    // -------------------------
                    // 廠商驗證
                    // -------------------------

                    const vendorValidation =
                        await validateVendors(
                            data.vendors
                        );


                    if (
                        !vendorValidation.success
                    ) {

                        socket.emit(
                            'tank_error',
                            {
                                message:
                                    vendorValidation.message
                            }
                        );

                        return;
                    }


                    const vendors =
                        vendorValidation.vendors;


                    const serverTimeStr =
                        getTaipeiTimeString();


                    const client =
                        await pool.connect();


                    try {

                        await client.query(
                            'BEGIN'
                        );


                        // -------------------------
                        // 原狀態
                        // -------------------------

                        const oldResult =
                            await client.query(
                                `
                                SELECT
                                    level,
                                    vendors
                                FROM tank_state
                                WHERE tank_no = $1
                                FOR UPDATE
                                `,
                                [
                                    tankNo
                                ]
                            );


                        let oldState;


                        if (
                            oldResult.rows.length === 0
                        ) {

                            oldState = {
                                level: 0,
                                vendors: []
                            };

                        } else {

                            oldState = {

                                level:
                                    Number(
                                        oldResult.rows[0].level
                                    ),

                                vendors:
                                    Array.isArray(
                                        oldResult.rows[0].vendors
                                    )
                                        ? oldResult.rows[0].vendors
                                        : []

                            };

                        }


                        const levelChanged =
                            oldState.level !== level;


                        const vendorsChanged =
                            !arraysEqual(
                                oldState.vendors,
                                vendors
                            );


                        if (
                            !levelChanged &&
                            !vendorsChanged
                        ) {

                            await client.query(
                                'ROLLBACK'
                            );


                            console.log(
                                `ℹ️ ${socket.user.username} ${tankNo} 無資料變更`
                            );


                            return;
                        }


                        // -------------------------
                        // 更新目前狀態
                        // -------------------------

                        await client.query(
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
                                JSON.stringify(vendors),
                                serverTimeStr,
                                socket.user.username
                            ]
                        );


                        // -------------------------
                        // 歷史紀錄
                        // -------------------------

                        await client.query(
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
                                level,
                                JSON.stringify(
                                    oldState.vendors
                                ),
                                JSON.stringify(
                                    vendors
                                ),
                                socket.user.username
                            ]
                        );


                        await client.query(
                            'COMMIT'
                        );


                        console.log(
                            `📝 ${socket.user.username} 修改 ${tankNo}：${oldState.level} → ${level}`
                        );


                        if (
                            level > tank.maxLevel
                        ) {

                            console.warn(
                                `⚠️ ${tankNo} 液位 ${level} 超過設定上限 ${tank.maxLevel}`
                            );

                        }


                        socket.broadcast.emit(
                            'sync_tank',
                            {
                                tankNo: tankNo,
                                level: level,
                                vendors: vendors,
                                timeStr: serverTimeStr
                            }
                        );


                    } catch (error) {

                        await client.query(
                            'ROLLBACK'
                        );


                        console.error(
                            '❌ 儲存桶槽資料失敗:',
                            error
                        );


                        socket.emit(
                            'tank_error',
                            {
                                message:
                                    '資料儲存失敗'
                            }
                        );


                    } finally {

                        client.release();

                    }


                } catch (error) {

                    console.error(
                        '❌ tank_changed 處理失敗:',
                        error
                    );


                    socket.emit(
                        'tank_error',
                        {
                            message:
                                '系統處理資料時發生錯誤'
                        }
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
// Server 啟動
// =====================================================

const PORT =
    process.env.PORT ||
    3000;


async function startServer() {

    try {

        if (!JWT_SECRET) {

            throw new Error(
                '缺少 JWT_SECRET'
            );

        }


        if (!DATABASE_URL) {

            throw new Error(
                '缺少 DATABASE_URL'
            );

        }


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
