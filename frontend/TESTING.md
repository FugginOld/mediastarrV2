# Testing Guide - MediaHunter Frontend

## Overview
The MediaHunter frontend uses **Vitest** for unit and integration testing, with **React Testing Library** for component testing.

## Setup

### Install Dependencies
```bash
cd frontend
npm install
```

This installs:
- `vitest` - Blazing fast unit test framework
- `@testing-library/react` - React component testing utilities
- `@testing-library/user-event` - User interaction simulation
- `jsdom` - DOM implementation for Node.js
- `@vitest/ui` - Visual test runner UI

### Configuration Files
- `vitest.config.ts` - Vitest configuration with jsdom environment
- `src/test/setup.ts` - Test utilities and mocks (localStorage, matchMedia)

## Running Tests

### Run all tests
```bash
npm run test
```

### Run tests in UI mode
```bash
npm run test:ui
```
Opens an interactive dashboard showing all tests with real-time results.

### Run tests once (CI mode)
```bash
npm run test:run
```

## Test Files

### `LoginPage.test.tsx`
Tests for the login flow:
- ✅ Renders login form with username/password fields
- ✅ Submits credentials correctly
- ✅ Displays error on failed login
- ✅ Allows theme selection

### `SetupPage.test.tsx`
Tests for the 4-step setup wizard:
- ✅ Renders all 4 setup steps
- ✅ Allows navigation between steps
- ✅ Validates password confirmation matching
- ✅ Requires at least one instance to be configured

### `ThemeProvider.test.tsx`
Tests for the theme system:
- ✅ Initializes with system theme by default
- ✅ Allows theme switching
- ✅ Persists selection to localStorage
- ✅ Applies theme class to document root
- ✅ Forces system theme on /setup route

### `DashboardPage.test.tsx`
Tests for the dashboard page:
- ✅ Renders dashboard with auth status indicator
- ✅ Shows logout button when auth enabled
- ✅ Displays start/stop/run-now controls
- ✅ Allows switching between tabs (Dashboard, Settings, Instances, History)

### `api-client.test.ts`
Tests for the API client:
- ✅ Caches CSRF token after first fetch
- ✅ Includes CSRF token in POST requests
- ✅ Handles 401 responses with redirect to login

## Writing New Tests

### Basic Test Structure
```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("MyComponent", () => {
  beforeEach(() => {
    // Setup before each test
  });

  it("should do something", async () => {
    const user = userEvent.setup();
    render(<MyComponent />);
    
    await user.click(screen.getByRole("button"));
    
    expect(screen.getByText("Expected text")).toBeInTheDocument();
  });
});
```

### Mocking API Calls
```tsx
import { vi } from "vitest";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", () => ({
  api: {
    getAuthStatus: vi.fn(),
    login: vi.fn(),
  },
}));

// In test:
vi.mocked(apiClient.api.login).mockResolvedValue({
  ok: true,
  target: "/dashboard",
});
```

### Using React Testing Library
```tsx
// Get elements
screen.getByRole("button", { name: /login/i })
screen.getByLabelText(/username/i)
screen.getByText(/error message/i)

// Wait for async operations
await waitFor(() => {
  expect(element).toBeInTheDocument();
});

// User interactions
const user = userEvent.setup();
await user.type(input, "text");
await user.click(button);
```

## Best Practices

1. **Test user behavior, not implementation**
   - ❌ Don't test internal state
   - ✅ Test what users see and interact with

2. **Use meaningful test descriptions**
   - ❌ `it("works")`
   - ✅ `it("allows users to login with valid credentials")`

3. **Mock external dependencies**
   - Mock API calls to isolate component logic
   - Use realistic response data

4. **Test critical paths**
   - Login flow
   - Setup wizard
   - Key user interactions
   - Error handling

5. **Keep tests fast**
   - No real network calls
   - Minimize DOM manipulation
   - Use mocks appropriately

## CI/CD Integration

Add to your CI pipeline:
```bash
npm run typecheck  # Type check
npm run test:run   # Run tests
npm run build      # Build for production
```

## Troubleshooting

### "Cannot find module '...'"
- Run `npm install` to ensure all dependencies are installed
- These are resolved at runtime, not at TypeScript compile time

### Tests timeout
- Increase timeout: `{ timeout: 10000 }`
- Ensure mocks are resolving correctly
- Check for infinite loops in components

### Vitest UI not loading
```bash
npm run test:ui
# Then visit http://localhost:__/__vitest__/
```

## Resources
- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)
- [User Event Documentation](https://testing-library.com/docs/user-event/intro)
