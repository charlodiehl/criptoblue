// ─────────────────────────────────────────────────────────────────────────────
// Grupos de notificaciones push, por rol.
//
// Cada grupo es un tipo de evento que el usuario puede activar/desactivar por
// separado desde la página de Notificaciones. La preferencia se guarda por usuario
// (email) en la tabla notification_prefs; la ausencia de valor = ACTIVADO por
// defecto (al prender las notificaciones, llegan todas hasta que se apaguen).
//
// Esta lista es la fuente de verdad compartida entre el frontend (página de
// preferencias) y el backend (envío por evento). Para agregar un evento nuevo:
// sumar una entrada acá y llamar a notifyAdmins(<key>) / notifyTienda(storeId, <key>)
// donde ocurra.
// ─────────────────────────────────────────────────────────────────────────────

// Eventos que se le notifican a los ADMINISTRADORES (cosas que tienen que atender).
export type EventoAdminKey =
  | 'transferencia_solicitada'
  | 'reembolso_solicitado'
  | 'pago_adjudicado'

// Eventos que se le notifican a una TIENDA (cosas que le pasan a su saldo).
export type EventoTiendaKey =
  | 'orden_emparejada'
  | 'transferencia_pagada'
  | 'reembolso_completado'

export type EventoKey = EventoAdminKey | EventoTiendaKey

export interface GrupoNotificacion {
  key: EventoKey
  label: string
  descripcion: string
}

export const GRUPOS_ADMIN: GrupoNotificacion[] = [
  {
    key: 'transferencia_solicitada',
    label: 'Transferencia solicitada',
    descripcion: 'Cuando una tienda (o un admin) arma una solicitud de transferencia para pagar.',
  },
  {
    key: 'reembolso_solicitado',
    label: 'Reembolso solicitado',
    descripcion: 'Cuando ingresa una solicitud de reembolso.',
  },
  {
    key: 'pago_adjudicado',
    label: 'Pago adjudicado por una tienda',
    descripcion: 'Cuando una tienda se adjudica un pago y le pone un número de orden, para ir a corroborar.',
  },
]

export const GRUPOS_TIENDA: GrupoNotificacion[] = [
  {
    key: 'orden_emparejada',
    label: 'Nueva orden emparejada',
    descripcion: 'Cuando entra un pago a tu registro: te avisa el monto y el número de orden. Incluye el saldo personalizado que te agregue un Super Admin.',
  },
  {
    key: 'transferencia_pagada',
    label: 'Transferencia pagada',
    descripcion: 'Cuando un Super Admin paga una transferencia que solicitaste: te avisa el monto y a quién se le pagó.',
  },
  {
    key: 'reembolso_completado',
    label: 'Reembolso completado',
    descripcion: 'Cuando un Super Admin paga un reembolso que solicitaste: te avisa el número de orden y el monto devuelto.',
  },
]

// Los grupos que le corresponden a un rol. Es lo que se muestra en la página y lo
// único que el backend acepta guardar para ese usuario.
export function gruposPara(role: 'admin' | 'tienda' | 'billetera'): GrupoNotificacion[] {
  return role === 'admin' ? GRUPOS_ADMIN : role === 'tienda' ? GRUPOS_TIENDA : []
}

// Preferencias de un usuario: { [key]: boolean }. Falta de clave = true (activado).
export type NotificationPrefs = Partial<Record<EventoKey, boolean>>

// ¿El usuario quiere recibir este grupo? Default: sí (mientras no lo haya apagado).
export function quiereEvento(prefs: NotificationPrefs | null | undefined, key: EventoKey): boolean {
  return prefs?.[key] !== false
}
