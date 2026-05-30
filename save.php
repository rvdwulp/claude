<?php
header('Content-Type: application/json');

$file = __DIR__ . '/data.json';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = file_get_contents('php://input');
    $decoded = json_decode($input, true);
    if ($decoded === null || !isset($decoded['taken'], $decoded['dagPlanning'])) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Ongeldige data']);
        exit;
    }
    file_put_contents($file, $input, LOCK_EX);
    echo json_encode(['status' => 'ok']);
} else {
    if (file_exists($file)) {
        echo file_get_contents($file);
    } else {
        echo json_encode(['taken' => [], 'dagPlanning' => []]);
    }
}
