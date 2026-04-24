import { toast } from 'sonner'

export const showSuccess = (msg: string, duration = 3000) =>
  toast.success(msg, { duration })

export const showError = (msg: string, duration = 5000) =>
  toast.error(msg, { duration })

export const showWarning = (msg: string, duration = 4000) =>
  toast.warning(msg, { duration })

export const showInfo = (msg: string, duration = 2500) =>
  toast.info(msg, { duration })
