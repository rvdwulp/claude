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
    $bytes = file_put_contents($file, $input, LOCK_EX);
    if ($bytes === false) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Schrijven mislukt — controleer schrijfrechten op data.json']);
    } else {
        echo json_encode(['status' => 'ok']);
    }
} else {
    if (file_exists($file)) {
        $inhoud = file_get_contents($file);
        $data = json_decode($inhoud, true);
        if ($data) {
            $data['heeftData'] = true;
            echo json_encode($data);
        } else {
            echo json_encode(['taken' => [], 'dagPlanning' => [], 'heeftData' => false]);
        }
    } else {
        echo json_encode(['taken' => [], 'dagPlanning' => [], 'heeftData' => false]);
    }
}
