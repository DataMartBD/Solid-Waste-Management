// Vitest global setup — runs before every test file.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount any React trees and clear persisted state between tests so
// localStorage-backed contexts (Auth, Data) start from a clean slate.
afterEach(() => {
  cleanup()
  localStorage.clear()
})
