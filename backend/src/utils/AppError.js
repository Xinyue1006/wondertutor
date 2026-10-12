// Throw this anywhere to send a clean error response: throw new AppError(404, 'Not found')
export class AppError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
