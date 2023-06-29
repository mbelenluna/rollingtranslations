<?php

$fullname = $_POST ['fullname'];
$email = $_POST ['email'];
$phonenumber = $_POST ['phonenumber'];
$servicerequested = $_POST ['servicerequested'];
$sourcelanguage = $_POST ['sourcelanguage'];
$targetlanguage = $_POST ['targetlanguage'];
$file = $_POST ['file'];
$message = $_POST ['message'];

$para = 'mariabelenluna18@gmail.com';
$asunto = 'New Submission from Contact Us';
$header = "From: ".$email;
$txt = "You have received an email from ".$fullname.$email.$phonenumber.$servicerequested.$sourcelanguage.$targetlanguage.$file.$message;


mail($para, $asunto, utf8_decode($txt), $header);

header('Location:success.html');

?>