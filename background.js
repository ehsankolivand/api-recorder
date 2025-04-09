// Note: requestMap is stored in memory and data might be lost if the service worker becomes inactive during very long recording sessions.
// Consider using chrome.storage.local per request for more robust persistence in future versions.
let currentTabId = null;
let requestMap = new Map();
let isDebuggerAttached = false;
let pendingResponses = new Map(); // Store pending responses to process later
let isProcessingResponses = false; // Flag to prevent concurrent processing
let isRecording = false; // Flag to track if we're in recording mode

// Debug logging function
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  if (data) {
    console.log('Data:', data);
  }
}

// Initialize state
chrome.runtime.onInstalled.addListener(() => {
  debugLog('Extension installed');
  chrome.storage.local.set({ isRecording: false });
});

// Keep service worker active
chrome.runtime.onStartup.addListener(() => {
  debugLog('Extension started');
  chrome.storage.local.set({ isRecording: false });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog('Received message from popup', message);
  try {
    switch (message.type) {
      case 'startRecording':
        debugLog('Starting recording for tab', message.tabId);
        startRecording(message.tabId);
        sendResponse({ success: true });
        break;
      case 'stopRecording':
        debugLog('Stopping recording');
        stopRecording();
        sendResponse({ success: true });
        break;
      case 'exportMarkdown':
        debugLog('Exporting to markdown');
        exportToMarkdown();
        sendResponse({ success: true });
        break;
    }
  } catch (error) {
    debugLog('Error handling message', error);
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true; // Keep the message channel open for async responses
});

// Handle tab updates and removals
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  debugLog(`Tab ${tabId} updated`, changeInfo);
  
  // If we're recording and this is a navigation to a new page
  if (isRecording && changeInfo.status === 'loading' && changeInfo.url) {
    debugLog(`Navigation detected to ${changeInfo.url}`);
    
    // If this is the current tab we're recording, we need to reattach the debugger
    if (tabId === currentTabId) {
      debugLog(`Current tab ${tabId} is navigating, will reattach debugger`);
      // We'll reattach the debugger when the page finishes loading
    }
  }
  
  // When the page finishes loading, reattach the debugger if needed
  if (isRecording && changeInfo.status === 'complete' && tabId === currentTabId) {
    debugLog(`Tab ${tabId} finished loading, checking debugger status`);
    if (!isDebuggerAttached) {
      debugLog(`Reattaching debugger to tab ${tabId}`);
      reattachDebugger(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  debugLog(`Tab ${tabId} removed`);
  if (tabId === currentTabId) {
    debugLog(`Current tab ${tabId} was closed, handling tab change`);
    // Tab was closed, but we don't stop recording
    // Just reset the current tab ID
    currentTabId = null;
    isDebuggerAttached = false;
  }
});

// Function to reattach debugger to a tab
async function reattachDebugger(tabId) {
  debugLog(`Attempting to reattach debugger to tab ${tabId}`);
  try {
    // Check if tab still exists
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      debugLog(`Tab ${tabId} no longer exists, cannot reattach`);
      return;
    }
    
    // Attach debugger
    await chrome.debugger.attach({ tabId }, '1.3');
    isDebuggerAttached = true;
    currentTabId = tabId;
    
    // Enable network tracking
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    debugLog(`Debugger reattached successfully to tab ${tabId}`);
  } catch (error) {
    debugLog(`Failed to reattach debugger to tab ${tabId}`, error);
    console.error('Failed to reattach debugger:', error);
  }
}

async function startRecording(tabId) {
  debugLog('Starting recording process', { tabId, currentTabId, isDebuggerAttached });
  try {
    // Reset state
    currentTabId = tabId;
    requestMap = new Map();
    pendingResponses = new Map();
    isDebuggerAttached = false;
    isProcessingResponses = false;
    isRecording = true;
    
    debugLog('State reset', { currentTabId, requestMapSize: requestMap.size, pendingResponsesSize: pendingResponses.size });
    
    // Check if tab still exists
    debugLog('Checking if tab exists', tabId);
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      debugLog('Tab not found', tabId);
      throw new Error('Tab not found');
    }
    debugLog('Tab exists', tab);
    
    // Attach debugger
    debugLog('Attaching debugger to tab', tabId);
    await chrome.debugger.attach({ tabId }, '1.3');
    isDebuggerAttached = true;
    debugLog('Debugger attached successfully', { tabId, isDebuggerAttached });
    
    // Enable network tracking
    debugLog('Enabling network tracking');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    debugLog('Network tracking enabled');
    
    // Update state
    debugLog('Updating storage state');
    chrome.storage.local.set({ isRecording: true });
    updateStatus(true);
    debugLog('Recording started successfully');
  } catch (error) {
    debugLog('Failed to start recording', error);
    console.error('Failed to start recording:', error);
    // Reset state on error
    currentTabId = null;
    isDebuggerAttached = false;
    isRecording = false;
    chrome.storage.local.set({ isRecording: false });
    debugLog('State reset after error', { currentTabId, isDebuggerAttached });
  }
}

async function stopRecording() {
  debugLog('Stopping recording process', { currentTabId, isDebuggerAttached });
  
  // Process any pending responses before detaching debugger
  if (isDebuggerAttached && currentTabId) {
    debugLog('Processing pending responses before detaching');
    await processPendingResponses();
  }
  
  if (currentTabId && isDebuggerAttached) {
    try {
      debugLog('Detaching debugger from tab', currentTabId);
      await chrome.debugger.detach({ tabId: currentTabId });
      debugLog('Debugger detached successfully');
    } catch (error) {
      debugLog('Error detaching debugger', error);
      console.error('Error detaching debugger:', error);
    }
  } else {
    debugLog('Cannot detach debugger', { currentTabId, isDebuggerAttached });
  }
  
  // Reset state regardless of detach success
  debugLog('Resetting state');
  currentTabId = null;
  isDebuggerAttached = false;
  isProcessingResponses = false;
  isRecording = false;
  chrome.storage.local.set({ isRecording: false });
  updateStatus(false);
  debugLog('Recording stopped, state reset', { currentTabId, isDebuggerAttached });
}

// Listen for debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
  debugLog(`Debugger event received: ${method}`, { source, params });
  
  // If we're recording but the event is from a different tab, try to reattach to that tab
  if (isRecording && source.tabId !== currentTabId) {
    debugLog(`Event from different tab ${source.tabId}, current tab is ${currentTabId}`);
    // If we don't have a current tab or the debugger isn't attached, try to attach to this tab
    if (!currentTabId || !isDebuggerAttached) {
      debugLog(`No current tab or debugger not attached, attempting to attach to tab ${source.tabId}`);
      reattachDebugger(source.tabId);
    }
  }
  
  // Only process events from the current tab
  if (source.tabId !== currentTabId) {
    debugLog(`Ignoring event for different tab`, { sourceTabId: source.tabId, currentTabId });
    return;
  }

  switch (method) {
    case 'Network.requestWillBeSent':
      debugLog('Handling requestWillBeSent', params);
      handleRequestWillBeSent(params);
      break;
    case 'Network.responseReceived':
      debugLog('Handling responseReceived', params);
      handleResponseReceived(params);
      break;
    case 'Network.loadingFinished':
      debugLog('Handling loadingFinished', params);
      handleLoadingFinished(params);
      break;
    case 'Network.loadingFailed':
      debugLog('Handling loadingFailed', params);
      handleLoadingFailed(params);
      break;
    default:
      debugLog(`Unhandled debugger event: ${method}`);
  }
});

function handleRequestWillBeSent(params) {
  const { requestId, request } = params;
  debugLog(`Request will be sent: ${requestId}`, { url: request.url, method: request.method });
  requestMap.set(requestId, {
    url: request.url,
    method: request.method,
    requestHeaders: request.headers,
    requestBody: request.postData,
    timestamp: Date.now()
  });
  debugLog(`Request stored in requestMap`, { requestMapSize: requestMap.size });
}

function handleResponseReceived(params) {
  const { requestId, response } = params;
  debugLog(`Response received: ${requestId}`, { status: response.status });
  const request = requestMap.get(requestId);
  if (request) {
    request.status = response.status;
    request.responseHeaders = response.headers;
    debugLog(`Response details stored for request: ${requestId}`);
  } else {
    debugLog(`No request found for response: ${requestId}`);
  }
}

function handleLoadingFailed(params) {
  const { requestId, errorText } = params;
  debugLog(`Loading failed: ${requestId}`, { errorText });
  const request = requestMap.get(requestId);
  if (request) {
    request.error = errorText;
    debugLog(`Error stored for request: ${requestId}`);
  } else {
    debugLog(`No request found for failed loading: ${requestId}`);
  }
}

async function handleLoadingFinished(params) {
  const { requestId } = params;
  debugLog(`Loading finished: ${requestId}`);
  const request = requestMap.get(requestId);
  if (request) {
    debugLog(`Request found for loading finished: ${requestId}`, { url: request.url });
    // Store the requestId for later processing
    pendingResponses.set(requestId, request);
    debugLog(`Added to pending responses`, { pendingResponsesSize: pendingResponses.size });
    
    // Try to process immediately if debugger is still attached
    if (isDebuggerAttached && currentTabId && !isProcessingResponses) {
      debugLog(`Processing response immediately for: ${requestId}`);
      await processResponse(requestId);
    } else {
      debugLog(`Cannot process response immediately`, { isDebuggerAttached, currentTabId, isProcessingResponses });
    }
  } else {
    debugLog(`No request found for loading finished: ${requestId}`);
  }
}

async function processPendingResponses() {
  if (isProcessingResponses) {
    debugLog('Already processing responses, skipping');
    return;
  }
  
  debugLog('Processing pending responses', { 
    pendingResponsesSize: pendingResponses.size, 
    isDebuggerAttached, 
    currentTabId 
  });
  
  if (!isDebuggerAttached || !currentTabId) {
    debugLog('Cannot process pending responses - debugger not attached or no current tab');
    return;
  }
  
  isProcessingResponses = true;
  
  try {
    const pendingIds = Array.from(pendingResponses.keys());
    debugLog(`Processing ${pendingIds.length} pending responses`);
    
    for (const requestId of pendingIds) {
      if (!isDebuggerAttached || !currentTabId) {
        debugLog('Debugger detached or tab changed during processing, stopping');
        break;
      }
      
      debugLog(`Processing pending response: ${requestId}`);
      await processResponse(requestId);
    }
    
    debugLog('Finished processing pending responses');
  } finally {
    isProcessingResponses = false;
    pendingResponses.clear();
  }
}

async function processResponse(requestId) {
  debugLog(`Processing response for request: ${requestId}`, { isDebuggerAttached, currentTabId });
  
  if (!isDebuggerAttached || !currentTabId) {
    debugLog(`Cannot process response - debugger not attached or no current tab`);
    return;
  }
  
  try {
    // Add a small delay to ensure response is ready
    debugLog(`Waiting 100ms before getting response body`);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    debugLog(`Getting response body for request: ${requestId}`);
    const response = await chrome.debugger.sendCommand(
      { tabId: currentTabId },
      'Network.getResponseBody',
      { requestId }
    );
    
    debugLog(`Response body received for request: ${requestId}`, { 
      base64Encoded: response.base64Encoded,
      bodyLength: response.body ? response.body.length : 0
    });
    
    const request = requestMap.get(requestId);
    if (!request) {
      debugLog(`No request found for response: ${requestId}`);
      return;
    }
    
    if (response.base64Encoded) {
      try {
        debugLog(`Decoding base64 response for request: ${requestId}`);
        request.responseBody = atob(response.body);
        debugLog(`Base64 response decoded successfully`);
      } catch (error) {
        debugLog(`Failed to decode base64 response`, error);
        console.error('Failed to decode base64 response:', error);
        request.responseBody = response.body; // Store raw base64 string if decoding fails
      }
    } else {
      debugLog(`Storing non-base64 response for request: ${requestId}`);
      request.responseBody = response.body;
    }
    
    // Remove from pending responses
    pendingResponses.delete(requestId);
    debugLog(`Removed from pending responses`, { pendingResponsesSize: pendingResponses.size });
    
    updateStatus(true);
  } catch (error) {
    // Check for specific error types that we can safely ignore
    const errorMessage = error.message || '';
    const isIgnorableError = 
      errorMessage.includes('No resource with given identifier found') ||
      errorMessage.includes('No data found for resource with given identifier') ||
      errorMessage.includes('Either tab id or extension id must be specified') ||
      errorMessage.includes('Debugger is not attached');
    
    if (isIgnorableError) {
      debugLog(`Ignoring expected error for request: ${requestId}`, { errorMessage });
      
      // For these errors, we'll still mark the request as processed
      pendingResponses.delete(requestId);
      
      // Add a note to the request that we couldn't get the response body
      const request = requestMap.get(requestId);
      if (request) {
        request.responseBody = "Response body could not be retrieved";
        request.responseError = errorMessage;
      }
    } else {
      debugLog(`Error getting response body`, error);
      console.error('Failed to get response body:', error);
    }
  }
}

function updateStatus(isRecording) {
  debugLog(`Updating status`, { isRecording, requestCount: requestMap.size });
  try {
    // Store the status in chrome.storage.local instead of sending a message
    chrome.storage.local.set({ 
      isRecording: isRecording,
      requestCount: requestMap.size 
    });
    debugLog(`Status updated successfully`);
  } catch (error) {
    debugLog(`Error updating status`, error);
    console.error('Error in updateStatus:', error);
  }
}

async function exportToMarkdown() {
  debugLog('Exporting to Markdown');
  
  try {
    const requests = Array.from(requestMap.values());
    debugLog(`Total requests: ${requests.length}`);
    
    // Helper function to get header value case-insensitively
    const getHeaderValue = (headers, headerName) => {
      if (!headers) return '';
      
      // If headers is an array (from older code), use find
      if (Array.isArray(headers)) {
        const header = headers.find(h => h.name.toLowerCase() === headerName.toLowerCase());
        return header ? header.value : '';
      }
      
      // If headers is an object, access directly
      const lowerHeaderName = headerName.toLowerCase();
      for (const key in headers) {
        if (key.toLowerCase() === lowerHeaderName) {
          return headers[key];
        }
      }
      return '';
    };
    
    // Filter out non-API resources using header-based approach
    const apiRequests = requests.filter(request => {
      // Get response Content-Type header
      const responseContentType = getHeaderValue(request.responseHeaders, 'content-type').toLowerCase();

      // Get request Accept header
      const requestAccept = getHeaderValue(request.requestHeaders, 'accept').toLowerCase();

      // Check for JSON response types
      const isJsonResponse = responseContentType.includes('application/json') ||
                           responseContentType.includes('application/vnd.api+json') ||
                           responseContentType.includes('application/problem+json');

      // Check for JSON request types
      const isJsonRequest = requestAccept.includes('application/json') ||
                          requestAccept.includes('application/vnd.api+json');

      // Exclude non-API content types
      const isNonApiContent = responseContentType.includes('text/html') ||
                            responseContentType.includes('text/css') ||
                            responseContentType.includes('text/javascript') ||
                            responseContentType.includes('application/javascript') ||
                            responseContentType.includes('image/') ||
                            responseContentType.includes('font/') ||
                            responseContentType.includes('text/plain');

      // Include if it's a JSON response or explicitly requests JSON
      // AND is not a non-API content type
      return (isJsonResponse || isJsonRequest) && !isNonApiContent;
    });
    
    debugLog(`Filtered API requests: ${apiRequests.length}`);
    
    // Group requests by URL path
    const groupedRequests = {};
    apiRequests.forEach(request => {
      const url = new URL(request.url);
      const path = url.pathname;
      
      if (!groupedRequests[path]) {
        groupedRequests[path] = [];
      }
      
      groupedRequests[path].push(request);
    });
    
    let markdown = '# API Documentation\n\n';
    markdown += `Generated on: ${new Date().toLocaleString()}\n\n`;
    
    // Sort paths alphabetically
    const sortedPaths = Object.keys(groupedRequests).sort();
    
    for (const path of sortedPaths) {
      const requests = groupedRequests[path];
      const methods = [...new Set(requests.map(r => r.method))].sort();
      
      markdown += `## ${path}\n\n`;
      markdown += `**Methods:** ${methods.join(', ')}\n\n`;
      
      // Use the first request as a template for each method
      for (const method of methods) {
        const templateRequest = requests.find(r => r.method === method);
        if (!templateRequest) continue;
        
        markdown += `### ${method} Request\n\n`;
        
        // Request Headers
        if (templateRequest.requestHeaders) {
          markdown += '#### Request Headers\n\n';
          markdown += '```\n';
          
          // Handle both array and object formats of requestHeaders
          if (Array.isArray(templateRequest.requestHeaders)) {
            templateRequest.requestHeaders.forEach(header => {
              markdown += `${header.name}: ${header.value}\n`;
            });
          } else if (typeof templateRequest.requestHeaders === 'object') {
            Object.entries(templateRequest.requestHeaders).forEach(([name, value]) => {
              markdown += `${name}: ${value}\n`;
            });
          }
          
          markdown += '```\n\n';
        }
        
        // Request Body (if any)
        if (templateRequest.requestBody) {
          markdown += '#### Request Body\n\n';
          try {
            const parsedBody = JSON.parse(templateRequest.requestBody);
            markdown += '```json\n';
            markdown += JSON.stringify(parsedBody, null, 2);
            markdown += '\n```\n\n';
          } catch (e) {
            markdown += '```text\n';
            markdown += templateRequest.requestBody;
            markdown += '\n```\n\n';
          }
        }
        
        // Response Structure
        markdown += '#### Response Structure\n\n';
        try {
          const responseBody = templateRequest.responseBody || '{}';
          const parsedResponse = JSON.parse(responseBody);
          markdown += '```json\n';
          markdown += JSON.stringify(parsedResponse, null, 2);
          markdown += '\n```\n\n';
        } catch (e) {
          markdown += '```text\n';
          markdown += templateRequest.responseBody || '{}';
          markdown += '\n```\n\n';
        }
        
        // Add note about number of requests
        const requestCount = requests.filter(r => r.method === method).length;
        if (requestCount > 1) {
          markdown += `*Note: ${requestCount} requests were captured for this endpoint.*\n\n`;
        }
      }
      
      markdown += '---\n\n';
    }
    
    // Create a data URL for the markdown content
    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);
    
    // Download the file
    await chrome.downloads.download({
      url: dataUrl,
      filename: 'api_documentation.md',
      saveAs: true
    });
    
    debugLog('Markdown export completed');
  } catch (error) {
    debugLog('Error exporting to Markdown', error);
    console.error('Error exporting to Markdown:', error);
    throw error;
  }
} 