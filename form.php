<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $name = $_POST['name'];
  $email = $_POST['email'];
  $subject = $_POST['subject'];
  $message = $_POST['message'];

  // Check if a file was uploaded
  if (isset($_FILES['attachment']) && $_FILES['attachment']['error'] === UPLOAD_ERR_OK) {
    $file = $_FILES['attachment'];
    $file_name = $file['name'];
    $file_tmp = $file['tmp_name'];
    $file_size = $file['size'];
    $file_type = $file['type'];

    // Move the uploaded file to a desired location
    move_uploaded_file($file_tmp, 'path/to/save/attachments/' . $file_name);
  }

  // Compose the email body
  $email_body = "Name: $name\n";
  $email_body .= "Email: $email\n";
  $email_body .= "Subject: $subject\n";
  $email_body .= "Message: $message\n";

  // Send the email
  $to = 'mariabelenluna18@gmail.com';
  $subject = 'New Form Submission';
  $headers = "From: $email\r\n";
  $headers .= "Reply-To: $email\r\n";
  $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

  // Attach the file to the email, if uploaded
  if (isset($file_name)) {
    $attachment_path = 'C:\Users\belen\OneDrive\Documents' . $file_name;
    $attachment = file_get_contents($attachment_path);
    $attachment_encoded = chunk_split(base64_encode($attachment));
    $headers .= "Content-Disposition: attachment; filename=\"$file_name\"\r\n";
    $headers .= "Content-Transfer-Encoding: base64\r\n";
    $headers .= "Content-ID: <attachment>\r\n\r\n";
    $headers .= "$attachment_encoded\r\n\r\n";
  }

  // Send the email
  mail($to, $subject, $email_body, $headers);

  // Redirect the user after submission (optional)
  header('Location: thank-you.html');
  exit();
}
?>