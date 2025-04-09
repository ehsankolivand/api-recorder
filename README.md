# API Recorder Chrome Extension

## What is this?
This is a simple Chrome extension I made. It helps you record network requests when you browse a website. It tries to find the API calls (like REST APIs using JSON) and saves them.

## Why I made this?
I needed a quick way to see the APIs a website uses and maybe make some simple docs for them, so I built this tool.

## Features
- Start and Stop recording button
- Saves request URL, method (GET, POST...), headers
- Tries to save request body and response body
- Handles Base64 encoded responses
- Tries to filter requests to show only API calls (looks at headers like `Content-Type`, `Accept` for JSON)
- Export all recorded API calls into one Markdown (`.md`) file, grouped by URL path and method

## How to Install
1.  Download this code (or use `git clone`)
2.  Open Chrome browser and go to `chrome://extensions` page
3.  Turn on 'Developer mode' (look in the top right corner)
4.  Click 'Load unpacked' button
5.  Select the folder where you downloaded the code
6.  Done! You should see the extension icon

## How to Use
1.  Go to the website you want to check
2.  Click the extension icon in your Chrome toolbar
3.  Click 'Start Recording'
4.  Now browse the website, click around, do things that make API calls
5.  You will see a notification bar from Chrome saying a tool is debugging the page. This is normal, needed for the extension to work
6.  When you have recorded enough, click 'Export to Markdown'. **Important:** It's best to export *before* you click Stop Recording, because data is cleared when you start again
7.  Click 'Stop Recording' when finished
8.  A file 'api_documentation.md' should be downloaded with the recorded info

## Permissions Needed (Please Read!)
### `debugger` Permission
This extension needs the 'debugger' permission. I know this permission sounds scary! But it is the *only* way Chrome extensions can see *all* network details, especially the request and response **bodies**. This extension uses it ONLY to capture the network data for you. **No data is sent anywhere, not to me, not to any server. It all stays on your computer.**

### Other Permissions
-   `storage`: To save recording status (if recording is on or off)
-   `downloads`: To let you download the Markdown file
-   `tabs` / `activeTab`: To know which tab you want to record and attach the debugger

## About Filtering
The extension tries hard to show only real API calls using headers (like `Content-Type: application/json`). But sometimes it might make mistakes - maybe miss some APIs or show something that is not an API. It's not perfect.

## Known Issues / Limitations
-   Filtering is not 100% perfect (see above).
-   If you record for a very very long time *without doing anything*, maybe Chrome stops the extension background process and you lose data. This is a Chrome thing (Service Worker inactivity).
-   Sometimes, getting the response body might fail for some requests (e.g., for redirects or if an error happens).
-   Very large response bodies might cause problems or not be saved completely.


## Problems or Ideas? / Contact Me

You can also find me on LinkedIn: [https://www.linkedin.com/in/ehsan-koolivand/](https://www.linkedin.com/in/ehsan-koolivand/)
