// Runs once before every test file (see vite.config.js's test.setupFiles).
// Adds jest-dom's matchers (toBeInTheDocument, toHaveTextContent, etc.) to
// Vitest's expect, so component tests can assert on rendered DOM the same
// readable way the wider React ecosystem does.
import '@testing-library/jest-dom'
