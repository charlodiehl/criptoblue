'use client'

import { PERMISOS } from '@/lib/permisos'
import EquipoGestion from '@/components/EquipoGestion'
import type { Toast } from './TiendaPortal'

// Sección "Equipo" del portal de tienda: integrantes con acceso + sus permisos.
// La pantalla es la misma que la de billeteras (components/EquipoGestion.tsx); acá
// solo se dice CUÁLES son los permisos y contra qué endpoints trabaja.

export default function EquipoTab({ qs, notify }: { qs: string; notify: (m: string, t?: Toast['type']) => void }) {
  return (
    <EquipoGestion
      entidad="la tienda"
      permisos={PERMISOS}
      apiBase="/api/tienda/equipo"
      qs={qs}
      notify={notify}
      notaAccesoBase="buscar pagos y ver el registro. No hace falta activarlo."
    />
  )
}
