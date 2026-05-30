<?php
header('Content-Type: text/html; charset=utf-8');
$file = __DIR__ . '/data.json';

echo '<pre style="font-family:monospace;font-size:14px;padding:20px">';
echo '<b>debug.php — server status</b>' . PHP_EOL . PHP_EOL;

echo 'data.json pad: ' . $file . PHP_EOL;
echo 'data.json bestaat: ' . (file_exists($file) ? 'JA' : 'NEE') . PHP_EOL;

if (file_exists($file)) {
    echo 'data.json grootte: ' . filesize($file) . ' bytes' . PHP_EOL;
    echo 'data.json rechten: ' . substr(sprintf('%o', fileperms($file)), -4) . PHP_EOL;
    echo 'data.json beschrijfbaar: ' . (is_writable($file) ? 'JA' : 'NEE') . PHP_EOL;
    $inhoud = file_get_contents($file);
    $data = json_decode($inhoud, true);
    if ($data) {
        echo 'JSON geldig: JA' . PHP_EOL;
        echo 'Aantal taken: ' . count($data['taken'] ?? []) . PHP_EOL;
        echo 'Dagplanning datums: ' . implode(', ', array_keys($data['dagPlanning'] ?? [])) . PHP_EOL;
        echo PHP_EOL . '--- Ruwe data ---' . PHP_EOL;
        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    } else {
        echo 'JSON geldig: NEE (corrupt bestand)' . PHP_EOL;
        echo PHP_EOL . 'Ruwe inhoud:' . PHP_EOL . $inhoud;
    }
} else {
    echo PHP_EOL . 'Map beschrijfbaar: ' . (is_writable(__DIR__) ? 'JA' : 'NEE') . PHP_EOL;
    echo 'PHP kan data.json aanmaken zodra je iets opslaat.' . PHP_EOL;
}

echo '</pre>';
