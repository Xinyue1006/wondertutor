import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

// jsdom has no scrollTo / scrollIntoView (the chat panel and profile tabs call them)
Element.prototype.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}
