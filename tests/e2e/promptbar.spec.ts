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

  await page.keyboard.press("Escape");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "AI" })
    .click();
  const refinementGoal = page.getByRole("textbox", {
    name: "Refinement goal",
  });
  await refinementGoal.focus();
  const refinementFontSize = await refinementGoal.evaluate((element) =>
    Number.parseFloat(window.getComputedStyle(element).fontSize),
  );
  if ((page.viewportSize()?.width ?? 0) < 768) {
    expect(refinementFontSize).toBeGreaterThanOrEqual(16);
  }
});

test("keeps refinement unavailable without a repo API key", async ({
  page,
}) => {
  let refinementRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/refine") {
      refinementRequests += 1;
    }
  });

  await page.goto("/");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "AI" })
    .click();

  await expect(
    page.getByText(/PROMPTBAR_OPENAI_API_KEY.*refinement and chat/),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Refinement goal" })
    .fill("Create a focused implementation prompt.");
  await expect(
    page.getByRole("button", { name: "Generate prompt" }),
  ).toBeDisabled();
  expect(refinementRequests).toBe(0);
});

test("generates a cited prompt without changing the URL or editor", async ({
  page,
}) => {
  const promptMarkdown =
    "# Implementation brief\n\nUse the selected constraints and return a verified result.";
  const refinementGoal = "Combine the selected guidance into one prompt.";
  const requestBodies: unknown[] = [];
  const pageErrors: Error[] = [];
  let expectedPromptId = "";
  let refinementAttempt = 0;

  page.on("pageerror", (error) => pageErrors.push(error));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { copiedRefinement?: string }).copiedRefinement =
            value;
        },
      },
    });
  });
  await mockApiEnabledSettings(page);
  await page.route("**/api/refine", async (route) => {
    refinementAttempt += 1;
    requestBodies.push(route.request().postDataJSON());
    if (refinementAttempt === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          promptMarkdown,
          citations: [
            {
              promptId: expectedPromptId,
              title: "Design an agent workflow",
            },
          ],
        }),
      });
      return;
    }
    if (refinementAttempt === 2) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unable to generate refinement." }),
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "",
    });
  });

  const searchResponsePromise = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  const searchResponse = await searchResponsePromise;
  const searchPayload = (await searchResponse.json()) as {
    results: Array<{ id: string }>;
  };
  expectedPromptId = searchPayload.results[0]?.id ?? "";
  expect(expectedPromptId).not.toBe("");
  const committedUrl = page.url();

  const navigation = page.getByRole("complementary");
  await navigation.getByRole("button", { name: "Editor" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  const editorBefore = await editor.textContent();
  await navigation.getByRole("button", { name: "AI" }).click();

  await page
    .getByRole("textbox", { name: "Refinement goal" })
    .fill(refinementGoal);
  const successfulRefinement = page.waitForResponse((response) => {
    return (
      response.status() === 200 &&
      new URL(response.url()).pathname === "/api/refine"
    );
  });
  await page.getByRole("button", { name: "Generate prompt" }).click();
  await successfulRefinement;

  expect(requestBodies[0]).toEqual({
    promptIds: [expectedPromptId],
    instruction: refinementGoal,
  });
  await expect(
    page.getByText("Refinement ready with 1 citation.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Generated prompt" }),
  ).toBeVisible();
  await expect(page.locator("pre code")).toHaveText(promptMarkdown);
  const citation = page
    .getByRole("listitem")
    .filter({ hasText: expectedPromptId });
  await expect(citation).toContainText("Design an agent workflow");
  await expect(citation).toContainText(expectedPromptId);
  expect(page.url()).toBe(committedUrl);

  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { copiedRefinement?: string }).copiedRefinement,
      ),
    )
    .toBe(promptMarkdown);
  await expect(page.getByText("Prompt copied.", { exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "Evals" }).click();
  await navigation.getByRole("button", { name: "AI" }).click();
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
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(
    page.getByText(
      "Couldn’t copy prompt. Select the displayed Markdown manually.",
      { exact: true },
    ),
  ).toBeVisible();

  const goalInput = page.getByRole("textbox", { name: "Refinement goal" });
  await goalInput.fill(`${refinementGoal} Updated.`);
  await expect(
    page.getByRole("heading", { name: "Generated prompt" }),
  ).toHaveCount(0);
  await goalInput.fill(refinementGoal);

  await navigation.getByRole("button", { name: "Search" }).click();
  const contextSwitch = page.getByRole("switch", {
    name: "Include Design an agent workflow in AI context",
  });
  await contextSwitch.click();
  await navigation.getByRole("button", { name: "AI" }).click();
  await expect(
    page.getByRole("heading", { name: "Generated prompt" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Refinement goal" }),
  ).toHaveValue(refinementGoal);
  await expect(
    page.getByRole("button", { name: "Generate prompt" }),
  ).toBeDisabled();

  await navigation.getByRole("button", { name: "Search" }).click();
  await contextSwitch.click();
  await navigation.getByRole("button", { name: "AI" }).click();

  const failedRefinement = page.waitForResponse((response) => {
    return (
      response.status() === 502 &&
      new URL(response.url()).pathname === "/api/refine"
    );
  });
  await page.getByRole("button", { name: "Generate prompt" }).click();
  await failedRefinement;

  expect(requestBodies[1]).toEqual({
    promptIds: [expectedPromptId],
    instruction: refinementGoal,
  });
  await expect(
    page.getByRole("heading", { name: "Generated prompt" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Unable to generate refinement.", { exact: true }),
  ).toHaveAttribute("role", "alert");
  await expect(
    page.getByRole("button", { name: "Generate prompt" }),
  ).toBeEnabled();

  const emptyFailure = page.waitForResponse((response) => {
    return (
      response.status() === 500 &&
      new URL(response.url()).pathname === "/api/refine"
    );
  });
  await page.getByRole("button", { name: "Generate prompt" }).click();
  await emptyFailure;
  expect(requestBodies[2]).toEqual({
    promptIds: [expectedPromptId],
    instruction: refinementGoal,
  });
  await expect(
    page.getByText("Unable to refine selected prompts.", { exact: true }),
  ).toHaveAttribute("role", "alert");
  expect(page.url()).toBe(committedUrl);
  expect(pageErrors).toEqual([]);

  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(editor).toHaveText(editorBefore ?? "");
  expect(page.url()).toBe(committedUrl);
});

test("ignores a refinement response after the selection changes", async ({
  page,
}) => {
  const goal = "Create one implementation prompt.";
  const pageErrors: Error[] = [];
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  page.on("pageerror", (error) => pageErrors.push(error));
  await mockApiEnabledSettings(page);
  await page.route("**/api/refine", async (route) => {
    const body = route.request().postDataJSON() as { promptIds: string[] };
    markRequestStarted();
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        promptMarkdown: "# Stale result",
        citations: [
          {
            promptId: body.promptIds[0],
            title: "Design an agent workflow",
          },
        ],
      }),
    });
  });

  const searchResponse = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await searchResponse;
  const committedUrl = page.url();
  const navigation = page.getByRole("complementary");
  await navigation.getByRole("button", { name: "AI" }).click();
  await page.getByRole("textbox", { name: "Refinement goal" }).fill(goal);
  const staleResponse = page.waitForResponse((response) => {
    return (
      response.status() === 200 &&
      new URL(response.url()).pathname === "/api/refine"
    );
  });
  await page.getByRole("button", { name: "Generate prompt" }).click();
  await requestStarted;

  await navigation.getByRole("button", { name: "Search" }).click();
  await page
    .getByRole("switch", {
      name: "Include Design an agent workflow in AI context",
    })
    .click();
  releaseResponse();
  await staleResponse;
  await navigation.getByRole("button", { name: "AI" }).click();

  await expect(
    page.getByRole("heading", { name: "Generated prompt" }),
  ).toHaveCount(0);
  await expect(page.getByText("# Stale result", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", { name: "Refinement goal" }),
  ).toHaveValue(goal);
  await expect(
    page.getByRole("button", { name: "Generate prompt" }),
  ).toBeDisabled();
  expect(page.url()).toBe(committedUrl);
  expect(pageErrors).toEqual([]);
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

async function mockApiEnabledSettings(page: Page) {
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        apiEnabled: true,
        apiKeyEnv: "PROMPTBAR_OPENAI_API_KEY",
        model: "test-model",
        embeddingModel: "test-embedding",
        dbPath: "/test/promptops.sqlite",
        corpusDir: "/test/corpus",
        promptopsStateDir: "/test/state",
        codexAvailable: false,
      }),
    });
  });
}

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
