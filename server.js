const express = require('express');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);

app.use(
    helmet({
        // 目前前端仍有 inline JavaScript / CSS / onclick。
        // 先保留其他 Helmet 安全標頭，避免 CSP 直接造成現有頁面失效。
        contentSecurityPolicy: false
    })
);

app.use(express.json());

app.use(
    express.static(
        'public',
        {
            setHeaders:
                (
                    res,
                    filePath
                ) => {

                    if (
                        filePath.endsWith(
                            '.html'
                        )
                    ) {

                        res.setHeader(
                            'Cache-Control',
                            'no-store, no-cache, must-revalidate, proxy-revalidate'
                        );

                        res.setHeader(
                            'Pragma',
                            'no-cache'
                        );

                        res.setHeader(
                            'Expires',
                            '0'
                        );
                    }
                }
        }
    )
);


// =====================================================
// 登入失敗限制
// 同一 IP 在 15 分鐘內最多失敗 5 次。
// 成功登入後立即清除該 IP 的失敗紀錄。
// Render 重啟後此紀錄會重置，屬於輕量型防暴力破解。
// =====================================================

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

const loginFailures = new Map();


function getLoginClientIp(req) {

    return String(
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}


function getLoginFailureState(ip) {

    const now = Date.now();

    const state =
        loginFailures.get(ip);


    if (
        !state ||
        now >= state.resetAt
    ) {

        const newState = {
            count: 0,
            resetAt:
                now + LOGIN_WINDOW_MS
        };


        loginFailures.set(
            ip,
            newState
        );


        return newState;
    }


    return state;
}


function isLoginBlocked(ip) {

    const state =
        getLoginFailureState(ip);


    return (
        state.count >=
        LOGIN_MAX_FAILURES
    );
}


function recordLoginFailure(ip) {

    const state =
        getLoginFailureState(ip);


    state.count += 1;


    loginFailures.set(
        ip,
        state
    );


    return state;
}


function clearLoginFailures(ip) {

    loginFailures.delete(ip);
}


setInterval(
    () => {

        const now =
            Date.now();


        for (
            const [
                ip,
                state
            ]
            of loginFailures.entries()
        ) {

            if (
                now >=
                state.resetAt
            ) {

                loginFailures.delete(
                    ip
                );
            }
        }
    },
    10 * 60 * 1000
).unref();

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
// 管理者帳號
// 預設只有 1001
// 日後可在 Render 新增：
// ADMIN_USERS=1001,1002
// =====================================================

const ADMIN_USERS = new Set(
    (process.env.ADMIN_USERS || '1001')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
);


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
// 共用驗證
// =====================================================

const ALLOWED_CATEGORIES =
    new Set([
        '硫酸',
        '鹽酸',
        '硝酸',
        '液鹼',
        '其它'
    ]);


function isAdminUsername(username) {
    return ADMIN_USERS.has(
        String(username || '')
    );
}


function normalizeSortOrder(value) {

    const number =
        Number(value);


    if (
        !Number.isInteger(number) ||
        number < 0 ||
        number > 10000
    ) {
        return null;
    }


    return number;
}


function validateTankMasterInput(body) {

    const tankNo =
        typeof body.tankNo === 'string'
            ? body.tankNo.trim()
            : '';


    const product =
        typeof body.product === 'string'
            ? body.product.trim()
            : '';


    const maxLevel =
        Number(body.maxLevel);


    const category =
        typeof body.category === 'string'
            ? body.category.trim()
            : '';


    const sortOrder =
        normalizeSortOrder(
            body.sortOrder
        );


    if (
        !/^[A-Za-z0-9_-]{1,20}$/.test(
            tankNo
        )
    ) {
        return {
            success: false,
            message: '桶槽編號格式錯誤'
        };
    }


    if (
        product.length < 1 ||
        product.length > 100
    ) {
        return {
            success: false,
            message: '品名長度錯誤'
        };
    }


    if (
        !Number.isFinite(maxLevel) ||
        maxLevel <= 0 ||
        maxLevel > 100000
    ) {
        return {
            success: false,
            message: '桶槽上限必須大於 0'
        };
    }


    if (
        !ALLOWED_CATEGORIES.has(
            category
        )
    ) {
        return {
            success: false,
            message: '桶槽分類錯誤'
        };
    }


    if (
        sortOrder === null
    ) {
        return {
            success: false,
            message: '排序必須是 0 到 10000 的整數'
        };
    }


    return {
        success: true,
        data: {
            tankNo,
            product,
            maxLevel,
            category,
            sortOrder
        }
    };
}


function validateVendorName(value) {

    const vendorName =
        typeof value === 'string'
            ? value.trim()
            : '';


    if (
        vendorName.length < 1 ||
        vendorName.length > 100
    ) {
        return {
            success: false,
            message: '廠商名稱長度錯誤'
        };
    }


    return {
        success: true,
        vendorName
    };
}


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
// API JWT
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
        !authHeader.startsWith(
            'Bearer '
        )
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


function verifyAdmin(
    req,
    res,
    next
) {

    if (
        !req.user ||
        !isAdminUsername(
            req.user.username
        )
    ) {

        return res
            .status(403)
            .json({
                success: false,
                message: '您沒有系統設定權限'
            });
    }


    next();
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
    ).format(
        new Date()
    );
}


// =====================================================
// 主檔讀取
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


    return result.rows.map(
        row => ({
            tankNo: row.tank_no,
            product: row.product,
            maxLevel:
                Number(
                    row.max_level
                ),
            category: row.category,
            sortOrder: row.sort_order
        })
    );
}


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


    return result.rows.map(
        row => ({
            id: row.id,
            vendorName: row.vendor_name,
            sortOrder: row.sort_order
        })
    );
}


async function loadAdminTankMaster() {

    const result =
        await pool.query(`
            SELECT
                tank_no,
                product,
                max_level,
                category,
                sort_order,
                enabled
            FROM tank_master
            ORDER BY
                sort_order ASC,
                tank_no ASC
        `);


    return result.rows.map(
        row => ({
            tankNo: row.tank_no,
            product: row.product,
            maxLevel:
                Number(
                    row.max_level
                ),
            category: row.category,
            sortOrder: row.sort_order,
            enabled: row.enabled
        })
    );
}


async function loadAdminVendorMaster() {

    const result =
        await pool.query(`
            SELECT
                id,
                vendor_name,
                sort_order,
                enabled
            FROM vendor_master
            ORDER BY
                sort_order ASC,
                vendor_name ASC
        `);


    return result.rows.map(
        row => ({
            id: row.id,
            vendorName: row.vendor_name,
            sortOrder: row.sort_order,
            enabled: row.enabled
        })
    );
}


async function getActiveTank(
    tankNo
) {

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
            [
                tankNo
            ]
        );


    if (
        result.rows.length === 0
    ) {
        return null;
    }


    return {
        tankNo:
            result.rows[0].tank_no,

        product:
            result.rows[0].product,

        maxLevel:
            Number(
                result.rows[0].max_level
            ),

        category:
            result.rows[0].category
    };
}


// =====================================================
// 目前桶槽狀態
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


    result.rows.forEach(
        row => {

            state[
                row.tank_no
            ] = {
                tankNo:
                    row.tank_no,

                level:
                    Number(
                        row.level
                    ),

                vendors:
                    Array.isArray(
                        row.vendors
                    )
                        ? row.vendors
                        : [],

                timeStr:
                    row.time_str || ""
            };
        }
    );


    return state;
}


// =====================================================
// 廠商資料驗證
// 允許同一天重複同一家廠商。
// 已停用廠商若原本已經在桶槽中，可以保留或移除；
// 但不能再新增更多筆。
// =====================================================

function countItems(
    array
) {

    const counts =
        new Map();


    array.forEach(
        item => {

            counts.set(
                item,
                (
                    counts.get(
                        item
                    ) || 0
                ) + 1
            );
        }
    );


    return counts;
}


async function validateVendorChanges(
    client,
    oldVendors,
    requestedVendors
) {

    if (
        !Array.isArray(
            requestedVendors
        )
    ) {

        return {
            success: false,
            message: '廠商資料格式錯誤'
        };
    }


    const cleaned =
        [];


    for (
        const value
        of requestedVendors
    ) {

        if (
            typeof value !==
            'string'
        ) {

            return {
                success: false,
                message: '廠商資料格式錯誤'
            };
        }


        const name =
            value.trim();


        if (
            name.length < 1 ||
            name.length > 100
        ) {

            return {
                success: false,
                message: '廠商名稱格式錯誤'
            };
        }


        cleaned.push(
            name
        );
    }


    const uniqueNames =
        [
            ...new Set(
                cleaned
            )
        ];


    if (
        uniqueNames.length === 0
    ) {

        return {
            success: true,
            vendors: []
        };
    }


    const result =
        await client.query(
            `
            SELECT
                vendor_name,
                enabled
            FROM vendor_master
            WHERE vendor_name = ANY($1::text[])
            `,
            [
                uniqueNames
            ]
        );


    const vendorMap =
        new Map(
            result.rows.map(
                row => [
                    row.vendor_name,
                    row.enabled
                ]
            )
        );


    for (
        const name
        of uniqueNames
    ) {

        if (
            !vendorMap.has(
                name
            )
        ) {

            return {
                success: false,
                message:
                    `廠商不存在：${name}`
            };
        }
    }


    const oldCounts =
        countItems(
            oldVendors
        );


    const newCounts =
        countItems(
            cleaned
        );


    for (
        const [
            name,
            enabled
        ]
        of vendorMap.entries()
    ) {

        if (
            !enabled
        ) {

            const oldCount =
                oldCounts.get(
                    name
                ) || 0;


            const newCount =
                newCounts.get(
                    name
                ) || 0;


            if (
                newCount >
                oldCount
            ) {

                return {
                    success: false,
                    message:
                        `廠商已停用，無法新增：${name}`
                };
            }
        }
    }


    return {
        success: true,
        vendors: cleaned
    };
}


// =====================================================
// 陣列比較
// =====================================================

function arraysEqual(
    a,
    b
) {

    if (
        a.length !==
        b.length
    ) {
        return false;
    }


    for (
        let i = 0;
        i < a.length;
        i++
    ) {

        if (
            a[i] !==
            b[i]
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
    (
        req,
        res
    ) => {

        const ip =
            getLoginClientIp(
                req
            );


        if (
            isLoginBlocked(
                ip
            )
        ) {

            const state =
                getLoginFailureState(
                    ip
                );


            const remainingSeconds =
                Math.max(
                    1,
                    Math.ceil(
                        (
                            state.resetAt -
                            Date.now()
                        ) / 1000
                    )
                );


            res.set(
                'Retry-After',
                String(
                    remainingSeconds
                )
            );


            return res
                .status(429)
                .json({
                    success: false,
                    code: 'LOGIN_BLOCKED',
                    remainingAttempts: 0,
                    maxAttempts:
                        LOGIN_MAX_FAILURES,
                    retryAfterSeconds:
                        remainingSeconds,
                    message:
                        `登入失敗次數過多，請 ${Math.ceil(remainingSeconds / 60)} 分鐘後再試`
                });
        }


        const {
            username,
            password
        } =
        req.body || {};


        if (
            validAccounts[
                username
            ] &&

            validAccounts[
                username
            ] ===
            password
        ) {

            clearLoginFailures(
                ip
            );


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


        const state =
            recordLoginFailure(
                ip
            );


        const remainingAttempts =
            Math.max(
                0,
                LOGIN_MAX_FAILURES -
                state.count
            );


        console.warn(
            `⚠️ 登入失敗 IP=${ip} 次數=${state.count}`
        );


        return res
            .status(401)
            .json({
                success: false,
                code:
                    remainingAttempts > 0
                        ? 'LOGIN_FAILED'
                        : 'LOGIN_BLOCKED',
                remainingAttempts:
                    remainingAttempts,
                maxAttempts:
                    LOGIN_MAX_FAILURES,
                message:
                    remainingAttempts > 0
                        ? `帳號或密碼錯誤，剩餘嘗試次數 ${remainingAttempts}`
                        : '登入失敗次數過多，請稍後再試'
            });
    }
);


// =====================================================
// 使用者資訊
// =====================================================

app.get(
    '/api/me',
    verifyApiToken,
    (
        req,
        res
    ) => {

        return res.json({
            success: true,
            username:
                req.user.username,
            isAdmin:
                isAdminUsername(
                    req.user.username
                )
        });
    }
);


// =====================================================
// 前端設定 API
// =====================================================

app.get(
    '/api/config',
    verifyApiToken,
    async (
        req,
        res
    ) => {

        try {

            const tanks =
                await loadTankMaster();


            const vendors =
                await loadVendorMaster();


            return res.json({
                success: true,
                tanks,
                vendors
            });

        } catch (error) {

            console.error(
                '❌ 讀取系統設定失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '讀取系統設定失敗'
                });
        }
    }
);


// =====================================================
// 管理介面：讀取全部設定
// =====================================================

app.get(
    '/api/admin/config',
    verifyApiToken,
    verifyAdmin,
    async (
        req,
        res
    ) => {

        try {

            const tanks =
                await loadAdminTankMaster();


            const vendors =
                await loadAdminVendorMaster();


            return res.json({
                success: true,
                tanks,
                vendors
            });

        } catch (error) {

            console.error(
                '❌ 管理設定讀取失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '管理設定讀取失敗'
                });
        }
    }
);


// =====================================================
// 管理介面：新增桶槽
// =====================================================

app.post(
    '/api/admin/tanks',
    verifyApiToken,
    verifyAdmin,
    async (
        req,
        res
    ) => {

        const validation =
            validateTankMasterInput(
                req.body || {}
            );


        if (
            !validation.success
        ) {

            return res
                .status(400)
                .json(validation);
        }


        const {
            tankNo,
            product,
            maxLevel,
            category,
            sortOrder
        } =
        validation.data;


        try {

            await pool.query(
                `
                INSERT INTO tank_master (
                    tank_no,
                    product,
                    max_level,
                    category,
                    sort_order,
                    enabled,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    TRUE,
                    NOW(),
                    NOW()
                )
                `,
                [
                    tankNo,
                    product,
                    maxLevel,
                    category,
                    sortOrder
                ]
            );


            console.log(
                `⚙️ ${req.user.username} 新增桶槽 ${tankNo}`
            );


            return res.json({
                success: true,
                message:
                    '桶槽新增完成'
            });

        } catch (error) {

            if (
                error &&
                error.code ===
                '23505'
            ) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        message:
                            `桶槽 ${tankNo} 已存在`
                    });
            }


            console.error(
                '❌ 新增桶槽失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '新增桶槽失敗'
                });
        }
    }
);


// =====================================================
// 管理介面：修改桶槽
// 桶號本身不允許修改
// =====================================================

app.patch(
    '/api/admin/tanks/:tankNo',
    verifyApiToken,
    verifyAdmin,
    async (
        req,
        res
    ) => {

        const tankNo =
            String(
                req.params.tankNo || ''
            ).trim();


        const validation =
            validateTankMasterInput({
                tankNo,
                product:
                    req.body.product,
                maxLevel:
                    req.body.maxLevel,
                category:
                    req.body.category,
                sortOrder:
                    req.body.sortOrder
            });


        if (
            !validation.success
        ) {

            return res
                .status(400)
                .json(validation);
        }


        if (
            typeof req.body.enabled !==
            'boolean'
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        '啟用狀態格式錯誤'
                });
        }


        try {

            const result =
                await pool.query(
                    `
                    UPDATE tank_master
                    SET
                        product = $2,
                        max_level = $3,
                        category = $4,
                        sort_order = $5,
                        enabled = $6,
                        updated_at = NOW()
                    WHERE tank_no = $1
                    `,
                    [
                        tankNo,
                        validation.data.product,
                        validation.data.maxLevel,
                        validation.data.category,
                        validation.data.sortOrder,
                        req.body.enabled
                    ]
                );


            if (
                result.rowCount === 0
            ) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            '找不到桶槽'
                    });
            }


            console.log(
                `⚙️ ${req.user.username} 修改桶槽 ${tankNo}`
            );


            return res.json({
                success: true,
                message:
                    '桶槽設定已更新'
            });

        } catch (error) {

            console.error(
                '❌ 修改桶槽失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '修改桶槽失敗'
                });
        }
    }
);


// =====================================================
// 管理介面：新增廠商
// =====================================================

app.post(
    '/api/admin/vendors',
    verifyApiToken,
    verifyAdmin,
    async (
        req,
        res
    ) => {

        const vendorValidation =
            validateVendorName(
                req.body.vendorName
            );


        if (
            !vendorValidation.success
        ) {

            return res
                .status(400)
                .json(vendorValidation);
        }


        const sortOrder =
            normalizeSortOrder(
                req.body.sortOrder
            );


        if (
            sortOrder === null
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        '排序必須是 0 到 10000 的整數'
                });
        }


        try {

            await pool.query(
                `
                INSERT INTO vendor_master (
                    vendor_name,
                    sort_order,
                    enabled,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1,
                    $2,
                    TRUE,
                    NOW(),
                    NOW()
                )
                `,
                [
                    vendorValidation.vendorName,
                    sortOrder
                ]
            );


            console.log(
                `⚙️ ${req.user.username} 新增廠商 ${vendorValidation.vendorName}`
            );


            return res.json({
                success: true,
                message:
                    '廠商新增完成'
            });

        } catch (error) {

            if (
                error &&
                error.code ===
                '23505'
            ) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        message:
                            `廠商 ${vendorValidation.vendorName} 已存在`
                    });
            }


            console.error(
                '❌ 新增廠商失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '新增廠商失敗'
                });
        }
    }
);


// =====================================================
// 管理介面：修改廠商
// 名稱不允許修改，避免影響舊歷史紀錄。
// 可修改排序、啟用/停用。
// =====================================================

app.patch(
    '/api/admin/vendors/:id',
    verifyApiToken,
    verifyAdmin,
    async (
        req,
        res
    ) => {

        const id =
            Number(
                req.params.id
            );


        const sortOrder =
            normalizeSortOrder(
                req.body.sortOrder
            );


        if (
            !Number.isInteger(id) ||
            id <= 0
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        '廠商 ID 錯誤'
                });
        }


        if (
            sortOrder === null
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        '排序必須是 0 到 10000 的整數'
                });
        }


        if (
            typeof req.body.enabled !==
            'boolean'
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        '啟用狀態格式錯誤'
                });
        }


        try {

            const result =
                await pool.query(
                    `
                    UPDATE vendor_master
                    SET
                        sort_order = $2,
                        enabled = $3,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING vendor_name
                    `,
                    [
                        id,
                        sortOrder,
                        req.body.enabled
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            '找不到廠商'
                    });
            }


            console.log(
                `⚙️ ${req.user.username} 修改廠商 ${result.rows[0].vendor_name}`
            );


            return res.json({
                success: true,
                message:
                    '廠商設定已更新'
            });

        } catch (error) {

            console.error(
                '❌ 修改廠商失敗:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        '修改廠商失敗'
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
    async (
        req,
        res
    ) => {

        try {

            let limit =
                Number(
                    req.query.limit
                ) || 50;


            if (
                limit < 1
            ) {
                limit = 1;
            }


            if (
                limit > 200
            ) {
                limit = 200;
            }


            const tankNo =
                typeof req.query.tankNo ===
                'string'
                    ? req.query.tankNo.trim()
                    : '';


            let result;


            if (
                tankNo
            ) {

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
                result.rows.map(
                    row => ({
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
                    })
                );


            return res.json({
                success: true,
                history
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
// Socket JWT
// =====================================================

io.use(
    (
        socket,
        next
    ) => {

        const token =
            socket.handshake.auth.token;


        if (
            !token
        ) {

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

                const tankNo =
                    typeof data.tankNo ===
                    'string'
                        ? data.tankNo.trim()
                        : '';


                try {

                    const tank =
                        await getActiveTank(
                            tankNo
                        );


                    if (
                        !tank
                    ) {

                        socket.emit(
                            'tank_error',
                            {
                                message:
                                    `桶槽不存在或已停用：${tankNo}`
                            }
                        );

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


                    const client =
                        await pool.connect();


                    try {

                        await client.query(
                            'BEGIN'
                        );


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
                                        oldResult
                                            .rows[0]
                                            .level
                                    ),

                                vendors:
                                    Array.isArray(
                                        oldResult
                                            .rows[0]
                                            .vendors
                                    )
                                        ? oldResult
                                            .rows[0]
                                            .vendors
                                        : []
                            };
                        }


                        const vendorValidation =
                            await validateVendorChanges(
                                client,
                                oldState.vendors,
                                data.vendors
                            );


                        if (
                            !vendorValidation.success
                        ) {

                            await client.query(
                                'ROLLBACK'
                            );


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


                        const levelChanged =
                            oldState.level !==
                            level;


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


                        const serverTimeStr =
                            getTaipeiTimeString();


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
                                level =
                                    EXCLUDED.level,
                                vendors =
                                    EXCLUDED.vendors,
                                time_str =
                                    EXCLUDED.time_str,
                                updated_by =
                                    EXCLUDED.updated_by,
                                updated_at =
                                    NOW()
                            `,
                            [
                                tankNo,
                                level,
                                JSON.stringify(
                                    vendors
                                ),
                                serverTimeStr,
                                socket.user.username
                            ]
                        );


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
                            level >
                            tank.maxLevel
                        ) {

                            console.warn(
                                `⚠️ ${tankNo} 液位 ${level} 超過設定上限 ${tank.maxLevel}`
                            );
                        }


                        socket.broadcast.emit(
                            'sync_tank',
                            {
                                tankNo,
                                level,
                                vendors,
                                timeStr:
                                    serverTimeStr
                            }
                        );

                    } catch (error) {

                        try {
                            await client.query(
                                'ROLLBACK'
                            );
                        } catch (_) {}


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

        if (
            !JWT_SECRET
        ) {

            throw new Error(
                '缺少 JWT_SECRET'
            );
        }


        if (
            !DATABASE_URL
        ) {

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
