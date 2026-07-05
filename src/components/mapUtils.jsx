import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

// Invalidate Leaflet's size when `watch` changes (e.g. entering/exiting fullscreen)
// so tiles re-tile to the new container dimensions.
export function MapResizer({ watch }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 220)
    return () => clearTimeout(t)
  }, [watch, map])
  return null
}
