import { expect, test, type Page } from "@playwright/test";

test("loads workbench and navigates primary surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Promptbar" })).toBeVisible();
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();

  const navigation = page.getByRole("complementary");

  await navigation.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Kind")).toBeVisible();

  const search = page.getByRole("textbox", { name: "Search corpus" });
  await search.fill("termination");
  const searchResponse = waitForSearch(page, "termination");
  await search.press("Enter");
  await searchResponse;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination");
  const results = page.getByRole("article");
  await expect(results).toHaveCount(1);
  await expect(
    results.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();
  await expect(
    results.getByRole("switch", {
      name: "Include Design an agent workflow in AI context",
    }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();

  await navigation.getByRole("button", { name: "Evals" }).click();
  await expect(page.getByRole("button", { name: /Run/i })).toBeVisible();
});

test("keeps workbench inputs mobile-safe with visible focus", async ({
  page,
}) => {
  await page.goto("/");
  const search = page.getByRole("textbox", { name: "Search corpus" });
  await search.focus();

  const styles = await search.evaluate((element) => {
    const computed = window.getComputedStyle(element);
    return {
      boxShadow: computed.boxShadow,
      fontSize: Number.parseFloat(computed.fontSize),
    };
  });
  expect(styles.boxShadow).not.toBe("none");
  if ((page.viewportSize()?.width ?? 0) < 768) {
    expect(styles.fontSize).toBeGreaterThanOrEqual(16);
  }

  await page.getByRole("button", { name: "Command" }).click();
  const command = page.getByPlaceholder("Command");
  await command.focus();
  const commandStyles = await command.evaluate((element) => {
    const input = window.getComputedStyle(element);
    const group = element.closest<HTMLElement>("[data-slot=input-group]");
    return {
      fontSize: Number.parseFloat(input.fontSize),
      groupBoxShadow: group ? window.getComputedStyle(group).boxShadow : "none",
    };
  });
  expect(commandStyles.groupBoxShadow).not.toBe("none");
  if ((page.viewportSize()?.width ?? 0) < 768) {
    expect(commandStyles.fontSize).toBeGreaterThanOrEqual(16);
  }
});

test("refreshes corpus data without changing a non-search view or URL", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = page.getByRole("complementary");
  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();

  const initialUrl = page.url();
  const searchRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/search") {
      searchRequests.push(request.url());
    }
  });

  await page.getByRole("button", { name: "Command" }).click();
  const corpusResponse = page.waitForResponse((response) => {
    return response.ok() && new URL(response.url()).pathname === "/api/corpus";
  });
  await page
    .getByRole("dialog")
    .getByText("Refresh index", { exact: true })
    .click();
  await corpusResponse;
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();
  expect(page.url()).toBe(initialUrl);
  expect(searchRequests).toEqual([]);

  await page.route("**/api/corpus", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "",
    });
  });
  await page.getByRole("button", { name: "Command" }).click();
  const failedCorpusResponse = page.waitForResponse((response) => {
    return (
      response.status() === 500 &&
      new URL(response.url()).pathname === "/api/corpus"
    );
  });
  await page
    .getByRole("dialog")
    .getByText("Refresh index", { exact: true })
    .click();
  await failedCorpusResponse;
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await expect(
    page.getByText("Unable to open corpus.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();
  expect(page.url()).toBe(initialUrl);
  expect(searchRequests).toEqual([]);
});

test("refreshes the visible Search draft from the command palette", async ({
  page,
}) => {
  const initialSearch = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialSearch;

  await page.getByRole("textbox", { name: "Search corpus" }).fill("database");
  const corpusRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/corpus") {
      corpusRequests.push(request.url());
    }
  });
  await page.getByRole("button", { name: "Command" }).click();
  const draftSearch = waitForSearch(page, "database");
  await page
    .getByRole("dialog")
    .getByText("Refresh index", { exact: true })
    .click();
  await draftSearch;

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=database");
  await expect(
    page.getByRole("heading", { name: "Plan a database change" }),
  ).toBeVisible();
  expect(corpusRequests).toEqual([]);
});

test("announces a failed Search command refresh in the active transient view", async ({
  page,
}) => {
  const initialSearch = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialSearch;

  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/search?**", async (route) => {
    markRequestStarted();
    await responseGate;
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "Search refresh unavailable.",
    });
  });

  await page.getByRole("textbox", { name: "Search corpus" }).fill("broken");
  await page.getByRole("button", { name: "Command" }).click();
  const failedSearch = waitForFailedSearch(page, "broken");
  await page
    .getByRole("dialog")
    .getByText("Refresh index", { exact: true })
    .click();
  await requestStarted;
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Editor" })
    .click();
  releaseResponse();
  await failedSearch;

  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();
  const searchError = page.getByText("Search refresh unavailable.", {
    exact: true,
  });
  await expect(searchError).toHaveCount(1);
  await expect(searchError).toBeVisible();
  expect(new URL(page.url()).search).toBe("?view=search&q=broken");
});

test("keeps mutation refreshes on the committed Search state", async ({
  page,
}) => {
  const initialSearch = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialSearch;

  await page.getByRole("textbox", { name: "Search corpus" }).fill("database");
  const committedRefresh = waitForSearch(page, "termination");
  const favoriteUpdate = page.waitForResponse((response) => {
    return (
      response.ok() &&
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/prompts/")
    );
  });
  await page.getByRole("button", { name: "Favorite" }).click();
  await favoriteUpdate;
  await committedRefresh;

  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("database");
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("?view=search&q=termination");
});

test("announces refresh failures in the view active when they settle", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = page.getByRole("complementary");
  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();

  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/corpus", async (route) => {
    markRequestStarted();
    await responseGate;
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "",
    });
  });

  const initialUrl = page.url();
  await page.getByRole("button", { name: "Command" }).click();
  const failedCorpusResponse = page.waitForResponse((response) => {
    return (
      response.status() === 500 &&
      new URL(response.url()).pathname === "/api/corpus"
    );
  });
  await page
    .getByRole("dialog")
    .getByText("Refresh index", { exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await requestStarted;

  await navigation.getByRole("button", { name: "Dashboard" }).click();
  releaseResponse();
  await failedCorpusResponse;

  const errorMessage = page.getByText("Unable to open corpus.", {
    exact: true,
  });
  await expect(errorMessage).toHaveCount(1);
  await expect(errorMessage).toBeVisible();
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();
  expect(page.url()).toBe(initialUrl);
});

test("returns to corpus refresh when Dashboard leaves a committed search", async ({
  page,
}) => {
  const initialSearch = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialSearch;

  const navigation = page.getByRole("complementary");
  const initialCorpusLoad = page.waitForResponse((response) => {
    return response.ok() && new URL(response.url()).pathname === "/api/corpus";
  });
  await navigation.getByRole("button", { name: "Dashboard" }).click();
  await initialCorpusLoad;
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("");
  await expect(
    page.getByText("Plan a database change", { exact: true }),
  ).toBeVisible();

  const searchRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/search") {
      searchRequests.push(request.url());
    }
  });
  await page.getByRole("button", { name: "Command" }).click();
  const corpusResponse = page.waitForResponse((response) => {
    return response.ok() && new URL(response.url()).pathname === "/api/corpus";
  });
  await page
    .getByRole("dialog")
    .getByText("Refresh index", { exact: true })
    .click();
  await corpusResponse;

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(searchRequests).toEqual([]);
});

test("announces a delayed Dashboard history restore failure in the active transient view", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();

  const search = page.getByRole("textbox", { name: "Search corpus" });
  await search.fill("termination");
  const initialSearch = waitForSearch(page, "termination");
  await search.press("Enter");
  await initialSearch;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination");

  const navigation = page.getByRole("complementary");
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/corpus", async (route) => {
    markRequestStarted();
    await responseGate;
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "",
    });
  });

  await page.goBack();
  await requestStarted;
  await navigation.getByRole("button", { name: "Editor" }).click();
  releaseResponse();

  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();
  const restoreError = page.getByText("Unable to open corpus.", {
    exact: true,
  });
  await expect(restoreError).toHaveCount(1);
  await expect(restoreError).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("keeps committed search URLs for transient views and restores Search on reload", async ({
  page,
}) => {
  const committedSearch = "?view=search&q=termination";
  const initialSearch = waitForSearch(page, "termination");
  await page.goto(`/${committedSearch}`);
  await initialSearch;

  const navigation = page.getByRole("complementary");
  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();
  expect(new URL(page.url()).search).toBe(committedSearch);

  await navigation.getByRole("button", { name: "AI" }).click();
  await expect(
    page.getByPlaceholder("Ask about selected prompts"),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe(committedSearch);

  await navigation.getByRole("button", { name: "Evals" }).click();
  await expect(page.getByRole("button", { name: /Run/i })).toBeVisible();
  expect(new URL(page.url()).search).toBe(committedSearch);

  const restoredSearch = waitForSearch(page, "termination");
  await page.reload();
  await restoredSearch;
  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("termination");
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe(committedSearch);
});

test("keeps valid search results when automatic prompt selection fails", async ({
  page,
}) => {
  await page.route("**/api/prompts/**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "Prompt detail unavailable.",
    });
  });
  const initialSearch = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialSearch;

  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();
  const detailError = page.getByText("Prompt detail unavailable.", {
    exact: true,
  });
  await expect(detailError).toHaveCount(1);
  await expect(detailError).toBeVisible();
  await expect(
    page.getByText("Unable to search corpus.", { exact: true }),
  ).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("?view=search&q=termination");
});

test("reports command and Editor export failures without leaking rejections", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  let exportAttempts = 0;
  await page.route("**/api/export", async (route) => {
    exportAttempts += 1;
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body:
        exportAttempts === 1
          ? "Command export unavailable."
          : "Editor export unavailable.",
    });
  });

  await page.getByRole("button", { name: "Command" }).click();
  const failedExport = page.waitForResponse((response) => {
    return (
      response.status() === 500 &&
      new URL(response.url()).pathname === "/api/export"
    );
  });
  await page
    .getByRole("dialog")
    .getByText("Export context", { exact: true })
    .click();
  await failedExport;

  await expect(page.getByRole("dialog")).not.toBeVisible();
  const commandError = page.getByText("Command export unavailable.", {
    exact: true,
  });
  await expect(commandError).toHaveCount(1);
  await expect(commandError).toBeVisible();

  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Editor" })
    .click();
  const failedEditorExport = page.waitForResponse((response) => {
    return (
      response.status() === 500 &&
      new URL(response.url()).pathname === "/api/export"
    );
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await failedEditorExport;

  const editorError = page.getByText("Editor export unavailable.", {
    exact: true,
  });
  await expect(editorError).toHaveCount(1);
  await expect(editorError).toBeVisible();
  expect(exportAttempts).toBe(2);
  expect(pageErrors).toEqual([]);

  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Evals" })
    .click();
  await expect(page.getByRole("button", { name: /Run/i })).toBeEnabled();
});

test("hydrates shareable filters and restores committed search history", async ({
  page,
}) => {
  const initialSearch =
    "?view=search&q=termination&mode=lexical&kind=canon&status=inbox&tag=agent";
  const initialResponse = waitForSearch(page, "termination");
  await page.goto(`/${initialSearch}`);
  await initialResponse;

  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination&kind=canon&status=inbox&tag=agent");
  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("termination");
  await expect(
    page.getByRole("combobox", { name: "Search mode" }),
  ).toContainText("FTS");
  await expect(page.getByRole("combobox", { name: "Kind" })).toContainText(
    "canon",
  );
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText(
    "inbox",
  );
  await expect(page.getByRole("combobox", { name: "Tag" })).toContainText(
    "agent",
  );
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Search corpus" }).fill("database");
  await page.getByRole("combobox", { name: "Tag" }).click();
  await page.getByRole("option", { name: /^database\b/ }).click();
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination&kind=canon&status=inbox&tag=agent");

  const refreshed = waitForSearch(page, "database");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  const databaseSearch =
    "?view=search&q=database&kind=canon&status=inbox&tag=database";
  await expect.poll(() => new URL(page.url()).search).toBe(databaseSearch);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Plan a database change" }),
  ).toBeVisible();

  const repeated = waitForSearch(page, "database");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await repeated;
  const restoredInitial = waitForSearch(page, "termination");
  await page.goBack();
  await restoredInitial;
  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("termination");
  await expect(page.getByRole("combobox", { name: "Tag" })).toContainText(
    "agent",
  );
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();

  const restoredDatabase = waitForSearch(page, "database");
  await page.goForward();
  await restoredDatabase;
  await expect.poll(() => new URL(page.url()).search).toBe(databaseSearch);
  await expect(
    page.getByRole("heading", { name: "Plan a database change" }),
  ).toBeVisible();

  const invalidFieldResponse = waitForSearch(page, "termination");
  await page.goto(
    "/?tag=agent&ignored=1&status=invalid&view=search&mode=invalid&q=termination&kind=canon",
  );
  await invalidFieldResponse;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination&kind=canon&tag=agent");
  await expect(
    page.getByRole("combobox", { name: "Search mode" }),
  ).toContainText("FTS");
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText(
    "All",
  );
  await expect(page.getByRole("combobox", { name: "Tag" })).toContainText(
    "agent",
  );
});

test("copies only the committed canonical search link with fallback guidance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { copiedSearchUrl?: string }).copiedSearchUrl =
            value;
        },
      },
    });
  });
  const response = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await response;

  await page
    .getByRole("textbox", { name: "Search corpus" })
    .fill("uncommitted draft");
  await page.getByRole("button", { name: "Copy link" }).click();
  const copiedUrl = await page.evaluate(
    () => (window as Window & { copiedSearchUrl?: string }).copiedSearchUrl,
  );
  expect(copiedUrl).toBe(page.url());
  expect(new URL(copiedUrl!).search).toBe("?view=search&q=termination");
  await expect(page.getByText("Search link copied.")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    });
  });
  const beforeFailure = page.url();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(
    page.getByText("Couldn’t copy link. Copy it from the address bar."),
  ).toBeVisible();
  expect(page.url()).toBe(beforeFailure);
});

test("clears stale cards and announces a failed committed search", async ({
  page,
}) => {
  const initialResponse = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialResponse;
  await expect(page.getByRole("article")).toHaveCount(1);

  let failureBody = "Search unavailable.";
  await page.route("**/api/search?**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: failureBody,
    });
  });
  const failedResponse = waitForFailedSearch(page, "broken");
  const search = page.getByRole("textbox", { name: "Search corpus" });
  await search.fill("broken");
  await search.press("Enter");
  await failedResponse;

  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=broken");
  await expect(page.getByRole("article")).toHaveCount(0);
  const searchAlert = page.getByText("Search unavailable.", { exact: true });
  await expect(searchAlert).toHaveAttribute("role", "alert");

  failureBody = "";
  const emptyFailure = waitForFailedSearch(page, "empty-error");
  await search.fill("empty-error");
  await search.press("Enter");
  await emptyFailure;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=empty-error");
  await expect(page.getByRole("article")).toHaveCount(0);
  const fallbackAlert = page.getByText("Unable to search corpus.", {
    exact: true,
  });
  await expect(fallbackAlert).toHaveAttribute("role", "alert");
});

function waitForSearch(page: Page, query: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.ok() &&
      url.pathname === "/api/search" &&
      url.searchParams.get("q") === query
    );
  });
}

function waitForFailedSearch(page: Page, query: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.status() === 500 &&
      url.pathname === "/api/search" &&
      url.searchParams.get("q") === query
    );
  });
}
