#[tokio::main]
async fn main() {
  if let Err(e) = app_lib::server::run().await {
    eprintln!("easyapply-server failed: {e}");
    std::process::exit(1);
  }
}
