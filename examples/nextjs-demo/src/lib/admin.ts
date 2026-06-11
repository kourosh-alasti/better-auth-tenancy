export function adminHeaders(): Headers {
  return new Headers({ "x-admin-key": process.env.ADMIN_SECRET! });
}
