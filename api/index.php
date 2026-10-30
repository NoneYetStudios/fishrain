<?php
/**
 * Fish Rain — Native PHP + SQLite Global Leaderboard API
 * Designed for zero-config deployment on JetHost / cPanel / Apache / LiteSpeed shared hosting.
 * Matches the Node.js API specification in server/leaderboard.js.
 */

error_reporting(0);
ini_set('display_errors', '0');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError($message, $code = 'error', $statusCode = 400) {
    http_response_code($statusCode);
    echo json_encode([
        'ok' => false,
        'error' => [
            'code' => $code,
            'message' => $message
        ]
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0755, true);
    @file_put_contents($dataDir . '/.htaccess', "Require all denied\n");
}

$dbPath = is_writable($dataDir) ? ($dataDir . '/leaderboard.sqlite') : (__DIR__ . '/leaderboard.sqlite');

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec('PRAGMA foreign_keys = ON;');
    $pdo->exec('PRAGMA busy_timeout = 5000;');
    @$pdo->exec('PRAGMA journal_mode = WAL;');

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS scores (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id       TEXT    NOT NULL UNIQUE,
            nickname         TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 64),
            score            INTEGER NOT NULL CHECK (score BETWEEN 0 AND 500000),
            game_mode        TEXT    NOT NULL CHECK (game_mode IN ('CAMPAIGN', 'QUICK_PLAY')),
            start_env_id     TEXT    NOT NULL,
            highest_env_id   TEXT    NOT NULL,
            highest_level    INTEGER NOT NULL CHECK (highest_level BETWEEN 1 AND 8),
            levels_cleared   INTEGER NOT NULL CHECK (levels_cleared BETWEEN 0 AND 8),
            flawless_levels  INTEGER NOT NULL CHECK (flawless_levels BETWEEN 0 AND 8),
            fish_caught      INTEGER NOT NULL CHECK (fish_caught >= 0),
            legendary_caught INTEGER NOT NULL CHECK (legendary_caught >= 0),
            max_combo        INTEGER NOT NULL CHECK (max_combo >= 0),
            best_catch_name  TEXT    NOT NULL DEFAULT '',
            elapsed_seconds  INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 2 AND 7200),
            created_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scores_rank       ON scores (score DESC, highest_level DESC, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_level_rank ON scores (highest_level DESC, score DESC, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_env_rank   ON scores (highest_env_id, score DESC, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_mode_rank  ON scores (game_mode, score DESC, created_at ASC, id ASC);
    ");

    $count = (int)$pdo->query("SELECT COUNT(*) FROM scores")->fetchColumn();
    if ($count === 0) {
        $now = (int)round(microtime(true) * 1000);
        $seeds = [
            ['seed_fr_1', 'CaptainBarnacle', 38450, 'CAMPAIGN', 'PUDDLE', 'OPEN_OCEAN', 8, 8, 4, 148, 6, 26, 'The Sovereign Golden Marlin', 410, $now - 86400000 * 4],
            ['seed_fr_2', 'RogueWaveRider', 29800, 'CAMPAIGN', 'PUDDLE', 'COAST', 7, 6, 3, 122, 3, 21, 'Baby Kraken Tentacle-Bass', 345, $now - 86400000 * 3],
            ['seed_fr_3', 'SoggySkipper42', 22150, 'CAMPAIGN', 'PUDDLE', 'BAY', 6, 5, 2, 98, 2, 18, 'Living Fossil Coelacanth', 290, $now - 86400000 * 2],
            ['seed_fr_4', 'AnvilDodger99', 16400, 'CAMPAIGN', 'PUDDLE', 'SWIFT_RIVER', 5, 4, 2, 81, 0, 15, 'Imperial Golden Koi', 230, $now - 86400000 * 2],
            ['seed_fr_5', 'TroutMagnet', 11250, 'CAMPAIGN', 'PUDDLE', 'CALM_RIVER', 4, 3, 1, 64, 0, 14, 'High-Voltage Eel', 185, $now - 86400000],
            ['seed_fr_6', 'BootCollector7', 7420, 'CAMPAIGN', 'PUDDLE', 'LAKE', 3, 2, 1, 46, 0, 11, 'Imperial Golden Koi', 135, $now - 43200000],
            ['seed_fr_7', 'PondPioneer', 3890, 'CAMPAIGN', 'PUDDLE', 'POND', 2, 1, 1, 28, 0, 9, 'Northern Pike', 85, $now - 21600000],
            ['seed_fr_8', 'PuddleSplash10', 1480, 'QUICK_PLAY', 'PUDDLE', 'PUDDLE', 1, 1, 1, 14, 0, 7, 'Largemouth Bass', 42, $now - 7200000]
        ];
        $seedStmt = $pdo->prepare("
            INSERT OR IGNORE INTO scores (
                session_id, nickname, score, game_mode, start_env_id, highest_env_id,
                highest_level, levels_cleared, flawless_levels, fish_caught, legendary_caught,
                max_combo, best_catch_name, elapsed_seconds, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        foreach ($seeds as $s) {
            $seedStmt->execute($s);
        }
    }
} catch (Exception $e) {
    jsonError('Database connection failed: ' . $e->getMessage(), 'db_error', 500);
}

$secretFile = $dataDir . '/secret.key';
if (file_exists($secretFile)) {
    $secret = trim(@file_get_contents($secretFile));
} else {
    $secret = bin2hex(random_bytes(32));
    @file_put_contents($secretFile, $secret);
}

function base64UrlEncode($data) {
    return strtr(rtrim(base64_encode($data), '='), '+/', '-_');
}

function base64UrlDecode($data) {
    return base64_decode(strtr($data, '-_', '+/'));
}

$ENV_ORDER = ['PUDDLE', 'POND', 'LAKE', 'CALM_RIVER', 'SWIFT_RIVER', 'BAY', 'COAST', 'OPEN_OCEAN'];
$ENV_DATA = [
    'PUDDLE'      => ['level' => 1, 'mult' => 1.00, 'clearBonus' => 250],
    'POND'        => ['level' => 2, 'mult' => 1.15, 'clearBonus' => 350],
    'LAKE'        => ['level' => 3, 'mult' => 1.30, 'clearBonus' => 500],
    'CALM_RIVER'  => ['level' => 4, 'mult' => 1.50, 'clearBonus' => 650],
    'SWIFT_RIVER' => ['level' => 5, 'mult' => 1.75, 'clearBonus' => 850],
    'BAY'         => ['level' => 6, 'mult' => 2.00, 'clearBonus' => 1100],
    'COAST'       => ['level' => 7, 'mult' => 2.35, 'clearBonus' => 1500],
    'OPEN_OCEAN'  => ['level' => 8, 'mult' => 2.80, 'clearBonus' => 2500]
];

$ACH_BONUS = [
    'FIRST_LEGENDARY' => 400,
    'COMBO_10'        => 350,
    'COMBO_20'        => 750,
    'BOOT_COLLECTOR'  => 250,
    'ROGUE_SURVIVOR'  => 500
];

function getComboMult($streak) {
    if ($streak >= 20) return 3.0;
    if ($streak >= 15) return 2.5;
    if ($streak >= 10) return 2.0;
    if ($streak >= 6)  return 1.5;
    if ($streak >= 3)  return 1.25;
    return 1.0;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$path = preg_replace('#^.*?/api/?#i', '', $uri);
$path = trim($path, '/');

if ($path === 'health' || $path === '') {
    jsonResponse(['ok' => true, 'service' => 'Fish Rain Leaderboard API (PHP)']);
}

if ($path === 'sessions' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) $body = [];
    $gameMode = $body['gameMode'] ?? 'CAMPAIGN';
    $startEnvId = $body['startEnvId'] ?? 'PUDDLE';

    if (!in_array($gameMode, ['CAMPAIGN', 'QUICK_PLAY'], true) || !isset($ENV_DATA[$startEnvId])) {
        jsonError('Unsupported game mode or environment.', 'invalid_session', 400);
    }
    if ($gameMode === 'CAMPAIGN' && $startEnvId !== 'PUDDLE') {
        jsonError('Campaign runs must start at the Puddle.', 'invalid_env', 400);
    }

    $nowMs = (int)round(microtime(true) * 1000);
    $payload = [
        'v' => 1,
        'n' => bin2hex(random_bytes(16)),
        'm' => $gameMode,
        'e' => $startEnvId,
        't' => $nowMs
    ];
    $b64Body = base64UrlEncode(json_encode($payload));
    $sig = hash_hmac('sha256', $b64Body, $secret, true);
    $token = $b64Body . '.' . base64UrlEncode($sig);

    jsonResponse([
        'token' => $token,
        'expiresAt' => $nowMs + (3 * 3600 * 1000)
    ], 201);
}

if ($path === 'scores' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        jsonError('Malformed JSON payload.', 'invalid_json', 400);
    }

    $token = $body['token'] ?? '';
    if (!is_string($token) || strlen($token) > 500 || !str_contains($token, '.')) {
        jsonError('Invalid game session token.', 'invalid_token', 401);
    }
    [$b64Body, $b64Sig] = explode('.', $token, 2);
    $expectedSig = hash_hmac('sha256', $b64Body, $secret, true);
    if (!hash_equals(base64UrlDecode($b64Sig), $expectedSig)) {
        jsonError('Invalid game session signature.', 'invalid_token', 401);
    }

    $sess = json_decode(base64UrlDecode($b64Body), true);
    $nowMs = (int)round(microtime(true) * 1000);
    if (!is_array($sess) || ($sess['v'] ?? 0) !== 1 || ($nowMs - $sess['t']) > (3 * 3600 * 1000)) {
        jsonError('Session token expired or invalid.', 'token_expired', 401);
    }

    $gameMode = $body['gameMode'] ?? '';
    $startEnvId = $body['startEnvId'] ?? '';
    $highestEnvId = $body['highestEnvId'] ?? '';
    if ($gameMode !== $sess['m'] || $startEnvId !== $sess['e'] || !isset($ENV_DATA[$highestEnvId])) {
        jsonError('Submission does not match signed game session.', 'session_mismatch', 422);
    }

    $nickname = trim($body['nickname'] ?? '');
    if (strlen($nickname) < 1 || strlen($nickname) > 16 || preg_match('/[<>&"\';]/', $nickname)) {
        jsonError('Nickname must be 1 to 16 characters.', 'invalid_nickname', 422);
    }

    $elapsed = (int)($body['elapsedSeconds'] ?? 0);
    $wallMs = $nowMs - $sess['t'];
    if ($wallMs < 2000 || ($elapsed * 1000) > ($wallMs + 5000)) {
        jsonError('Run timing does not match the game session.', 'implausible_run', 422);
    }

    $startIdx = array_search($startEnvId, $ENV_ORDER, true);
    $highIdx = array_search($highestEnvId, $ENV_ORDER, true);
    $levelsCleared = (int)($body['levelsCleared'] ?? 0);
    $flawlessLevels = (int)($body['flawlessLevels'] ?? 0);
    $catchScore = (int)($body['catchScore'] ?? 0);
    $maxCombo = (int)($body['maxCombo'] ?? 0);

    $levelBonusTotal = 0;
    for ($i = 0; $i < $levelsCleared; $i++) {
        $ek = $ENV_ORDER[$startIdx + $i] ?? null;
        if ($ek && isset($ENV_DATA[$ek])) {
            $levelBonusTotal += $ENV_DATA[$ek]['clearBonus'];
        }
    }
    $flawlessBonusTotal = $flawlessLevels * 400;
    $comboMilestoneBonus = $maxCombo * 15;
    $achTotal = 0;
    if (!empty($body['achievements']) && is_array($body['achievements'])) {
        foreach ($body['achievements'] as $achId) {
            if (isset($ACH_BONUS[$achId])) $achTotal += $ACH_BONUS[$achId];
        }
    }

    $recomputedScore = $catchScore + $levelBonusTotal + $flawlessBonusTotal + $comboMilestoneBonus + $achTotal;
    if ($recomputedScore !== (int)($body['score'] ?? -1)) {
        jsonError('Submitted score does not match official scoring formula.', 'score_mismatch', 422);
    }

    $rarities = $body['catchesByRarity'] ?? [];
    $fishCaught = (int)($rarities['COMMON'] ?? 0) + (int)($rarities['UNCOMMON'] ?? 0) + (int)($rarities['RARE'] ?? 0) + (int)($rarities['LEGENDARY'] ?? 0);
    $legendaryCaught = (int)($rarities['LEGENDARY'] ?? 0);
    $highestLevel = $ENV_DATA[$highestEnvId]['level'];
    $bestCatchName = substr(trim($body['bestCatchName'] ?? 'None Yet'), 0, 48);

    try {
        $stmt = $pdo->prepare("
            INSERT INTO scores (
                session_id, nickname, score, game_mode, start_env_id, highest_env_id,
                highest_level, levels_cleared, flawless_levels, fish_caught, legendary_caught,
                max_combo, best_catch_name, elapsed_seconds, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $sess['n'], $nickname, $recomputedScore, $gameMode, $startEnvId, $highestEnvId,
            $highestLevel, $levelsCleared, $flawlessLevels, $fishCaught, $legendaryCaught,
            $maxCombo, $bestCatchName, $elapsed, $nowMs
        ]);
        $rowId = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE')) {
            jsonError('This game session has already been submitted.', 'duplicate', 409);
        }
        jsonError('Database error: ' . $e->getMessage(), 'db_error', 500);
    }

    $rankCond = '(score > ? OR (score = ? AND highest_level > ?) OR (score = ? AND highest_level = ? AND created_at < ?) OR (score = ? AND highest_level = ? AND created_at = ? AND id < ?))';
    $rParams = [$recomputedScore, $recomputedScore, $highestLevel, $recomputedScore, $highestLevel, $nowMs, $recomputedScore, $highestLevel, $nowMs, $rowId];

    $stGlobal = $pdo->prepare("SELECT COUNT(*) FROM scores WHERE $rankCond");
    $stGlobal->execute($rParams);
    $globalRank = (int)$stGlobal->fetchColumn() + 1;

    $stEnv = $pdo->prepare("SELECT COUNT(*) FROM scores WHERE highest_env_id = ? AND $rankCond");
    $stEnv->execute(array_merge([$highestEnvId], $rParams));
    $envRank = (int)$stEnv->fetchColumn() + 1;

    $stMode = $pdo->prepare("SELECT COUNT(*) FROM scores WHERE game_mode = ? AND $rankCond");
    $stMode->execute(array_merge([$gameMode], $rParams));
    $modeRank = (int)$stMode->fetchColumn() + 1;

    jsonResponse([
        'entry' => [
            'nickname' => $nickname,
            'score' => $recomputedScore,
            'gameMode' => $gameMode,
            'startEnvId' => $startEnvId,
            'highestEnvId' => $highestEnvId,
            'highestLevel' => $highestLevel,
            'levelsCleared' => $levelsCleared,
            'flawlessLevels' => $flawlessLevels,
            'fishCaught' => $fishCaught,
            'legendaryCaught' => $legendaryCaught,
            'maxCombo' => $maxCombo,
            'bestCatchName' => $bestCatchName,
            'elapsedSeconds' => $elapsed,
            'createdAt' => $nowMs
        ],
        'ranks' => [
            'global' => $globalRank,
            'env' => $envRank,
            'mode' => $modeRank
        ]
    ], 201);
}

if ($path === 'leaderboard' && $method === 'GET') {
    $env = $_GET['env'] ?? 'all';
    $mode = $_GET['mode'] ?? 'all';
    $sort = $_GET['sort'] ?? 'score';
    $limit = max(1, min(50, (int)($_GET['limit'] ?? 25)));
    $offset = max(0, min(10000, (int)($_GET['offset'] ?? 0)));

    $where = [];
    $params = [];

    if ($env !== 'all' && isset($ENV_DATA[$env])) {
        $where[] = 'highest_env_id = ?';
        $params[] = $env;
    }
    if ($mode !== 'all' && in_array($mode, ['CAMPAIGN', 'QUICK_PLAY'], true)) {
        $where[] = 'game_mode = ?';
        $params[] = $mode;
    }

    $whereSql = count($where) ? ('WHERE ' . implode(' AND ', $where)) : '';
    $orderSql = ($sort === 'level')
        ? 'ORDER BY highest_level DESC, score DESC, created_at ASC, id ASC'
        : 'ORDER BY score DESC, highest_level DESC, created_at ASC, id ASC';

    $cStmt = $pdo->prepare("SELECT COUNT(*) FROM scores $whereSql");
    $cStmt->execute($params);
    $total = (int)$cStmt->fetchColumn();

    $lStmt = $pdo->prepare("SELECT * FROM scores $whereSql $orderSql LIMIT ? OFFSET ?");
    $lStmt->execute(array_merge($params, [$limit, $offset]));
    $rows = $lStmt->fetchAll();

    $entries = [];
    foreach ($rows as $i => $r) {
        $entries[] = [
            'rank' => $offset + $i + 1,
            'nickname' => $r['nickname'],
            'score' => (int)$r['score'],
            'gameMode' => $r['game_mode'],
            'startEnvId' => $r['start_env_id'],
            'highestEnvId' => $r['highest_env_id'],
            'highestLevel' => (int)$r['highest_level'],
            'levelsCleared' => (int)$r['levels_cleared'],
            'flawlessLevels' => (int)$r['flawless_levels'],
            'fishCaught' => (int)$r['fish_caught'],
            'legendaryCaught' => (int)$r['legendary_caught'],
            'maxCombo' => (int)$r['max_combo'],
            'bestCatchName' => $r['best_catch_name'],
            'elapsedSeconds' => (int)$r['elapsed_seconds'],
            'createdAt' => (int)$r['created_at']
        ];
    }

    jsonResponse([
        'entries' => $entries,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'sort' => $sort,
        'filter' => ['env' => $env === 'all' ? null : $env, 'mode' => $mode === 'all' ? null : $mode]
    ]);
}

jsonError('Unknown API endpoint', 'not_found', 404);
