/**
 * Google Apps Script Web App for Quiz Results Storage
 * 
 * Instructions:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code in the editor
 * 4. Paste this entire code into the editor
 * 5. Click Deploy > New Deployment > Web App
 * 6. Set "Execute as" to your email, "Who has access" to "Anyone"
 * 7. Copy the deployment URL and use it in the quiz app
 * 
 * The script will automatically create sheets and store quiz data
 */

// Configure this sheet ID (optional - if empty, uses active sheet)
const SHEET_ID = ""; // Leave empty to use the current sheet

// Get the sheet to use
function getSheet() {
  if (SHEET_ID) {
    return SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  }
  return SpreadsheetApp.getActiveSheet();
}

// Initialize sheet headers if needed
function initializeSheet() {
  const sheet = getSheet();
  let firstRow = null;
  
  if (sheet.getLastColumn() > 0) {
    firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  
  // Check if headers already exist
  if (!firstRow || firstRow[0] !== "Timestamp") {
    // Clear existing data if any
    if (sheet.getLastRow() > 0) {
      sheet.deleteRows(1, sheet.getLastRow());
    }
    
    // Add headers
    const headers = [
      "Timestamp",
      "User Name",
      "Score",
      "Total Questions",
      "Completed",
      "Percentage",
      "Answers JSON"
    ];
    
    sheet.appendRow(headers);
    
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#667eea");
    headerRange.setFontColor("white");
    headerRange.setFontWeight("bold");
    
    // Auto-resize columns
    sheet.autoResizeColumns(1, headers.length);
  }
}

// Main doPost function - receives data from the quiz app
function doPost(e) {
  try {
    // Parse the request body
    const data = JSON.parse(e.postData.contents);
    
    // Initialize sheet on first use
    const sheet = getSheet();
    if (sheet.getLastRow() === 0) {
      initializeSheet();
    }
    
    // Prepare row data
    // Store timestamp as Date object so Google Sheets recognizes it as a date
    const timestamp = new Date();
    const userName = data.userName || "Anonymous";
    const score = data.score || 0;
    const totalQuestions = data.totalQuestions || 0;
    const percentage = data.percentage || 0;
    const completed = data.completed !== undefined ? data.completed : true; // Default to true for backward compatibility
    const answersJSON = JSON.stringify(data.answers || []);
    
    // Append data to sheet
    sheet.appendRow([
      timestamp,
      userName,
      score,
      totalQuestions,
      completed ? "Yes" : "No",
      percentage,
      answersJSON
    ]);
    
    // Return success response
    return ContentService
      .createTextOutput(JSON.stringify({
        result: "success",
        message: "Quiz results saved successfully!",
        data: {
          userName: userName,
          score: score,
          timestamp: timestamp
        }
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Log the error
    Logger.log("Error: " + error.toString());
    
    // Return error response
    return ContentService
      .createTextOutput(JSON.stringify({
        result: "error",
        message: "Failed to save quiz results",
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// For testing - can be called from the Script Editor
function testDoPost() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        userName: "Test User",
        score: 4,
        totalQuestions: 5,
        percentage: 80,
        timestamp: new Date().toISOString(),
        answers: [
          { questionIndex: 0, selectedIndex: 2, correctIndex: 2, isCorrect: true },
          { questionIndex: 1, selectedIndex: 1, correctIndex: 1, isCorrect: true },
          { questionIndex: 2, selectedIndex: 3, correctIndex: 3, isCorrect: true },
          { questionIndex: 3, selectedIndex: 0, correctIndex: 1, isCorrect: false },
          { questionIndex: 4, selectedIndex: 2, correctIndex: 2, isCorrect: true }
        ]
      })
    }
  };
  
  const result = doPost(testData);
  Logger.log(result.getContent());
}

/**
 * ADVANCED: Create a separate results sheet for analysis
 * Uncomment to use - creates formulas to summarize quiz data
 */
function createAnalyticsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let analyticsSheet = ss.getSheetByName("Analytics");
  
  if (!analyticsSheet) {
    analyticsSheet = ss.insertSheet("Analytics");
    
    // Get the name of the data sheet
    const dataRef = "'" + getSheet().getName() + "'!";
    
    // Add summary headers
    analyticsSheet.appendRow(["Quiz Analytics"]);
    analyticsSheet.appendRow(["Total Submissions", `=COUNTA(${dataRef}A:A)-1`]);
    analyticsSheet.appendRow(["Average Score", `=AVERAGE(${dataRef}C:C)`]);
    analyticsSheet.appendRow(["Highest Score", `=MAX(${dataRef}C:C)`]);
    analyticsSheet.appendRow(["Lowest Score", `=MIN(${dataRef}C:C)`]);
    
    analyticsSheet.setColumnWidth(1, 200);
    analyticsSheet.setColumnWidth(2, 200);
  }
}

// --- DASHBOARD API ---

// Handle GET requests to return dashboard metrics
function doGet(e) {
  try {
    const sheet = getSheet();
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    // Check if we have data (more than just the header)
    if (values.length <= 1) {
      return ContentService
        .createTextOutput(JSON.stringify({
          result: "success",
          totalPlayers: 0,
          averageScore: 0,
          topScores: []
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Extract data
    const headers = values[0];
    const rows = values.slice(1);
    
    // Find column indexes
    const nameIndex = headers.indexOf("User Name");
    const scoreIndex = headers.indexOf("Score");
    const totalQuestionsIndex = headers.indexOf("Total Questions");
    const timestampIndex = headers.indexOf("Timestamp");
    const completedIndex = headers.indexOf("Completed");
    const answersIndex = headers.indexOf("Answers JSON");
    
    if (nameIndex === -1 || scoreIndex === -1) {
      throw new Error("Could not find required columns: 'User Name' or 'Score'");
    }
    
    let totalScore = 0;
    const players = [];
    const rawTimestamps = []; // Store raw timestamp strings for completed quizzes
    const rawTimestampsIncomplete = []; // Store raw timestamp strings for incomplete quizzes
    
    rows.forEach(row => {
      const name = row[nameIndex] || "Anonymous";
      const score = Number(row[scoreIndex]) || 0;
      const totalQuestions = totalQuestionsIndex !== -1 ? (Number(row[totalQuestionsIndex]) || 0) : 0;
      
      // Parse answers JSON to get count if totalQuestions is not available
      let answersCount = 0;
      if (answersIndex !== -1 && row[answersIndex]) {
        try {
          const answers = JSON.parse(row[answersIndex]);
          if (Array.isArray(answers)) {
            answersCount = answers.length;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      // Use totalQuestions from sheet, or fallback to answers count
      const finalTotalQuestions = totalQuestions > 0 ? totalQuestions : answersCount;
      
      // Check if quiz was completed (default to true for backward compatibility)
      // Handle various formats: "Yes", "No", true, false, "TRUE", "FALSE", etc.
      let isCompleted = true; // Default to completed for backward compatibility
      if (completedIndex !== -1) {
        const completedCellValue = row[completedIndex];
        // Check if cell has a value
        if (completedCellValue !== null && completedCellValue !== undefined && completedCellValue !== "") {
          // Convert to string, trim whitespace, and check
          const completedValue = String(completedCellValue).trim().toUpperCase();
          // Check for "No", "FALSE", "0", "N", false, etc.
          if (completedValue === "NO" || completedValue === "FALSE" || completedValue === "0" || completedValue === "N" || completedCellValue === false) {
            isCompleted = false;
          } else if (completedValue === "YES" || completedValue === "TRUE" || completedValue === "1" || completedValue === "Y" || completedCellValue === true) {
            isCompleted = true;
          }
          // If it doesn't match any known pattern, keep default (true)
        }
        // If cell is empty/null/undefined, default to true (backward compatibility)
      }
      
      // Override: If totalQuestions is less than 10, mark as incomplete
      // (A complete quiz should have answered all 10 questions)
      if (finalTotalQuestions < 10) {
        isCompleted = false;
      }
      
      // Only count completed quizzes for average score
      if (isCompleted) {
        totalScore += score;
      }

      // Get raw timestamp string as-is from the sheet
      let rawTimestamp = "";
      let timeOfDay = "";
      if (timestampIndex !== -1 && row[timestampIndex]) {
        const timestampValue = row[timestampIndex];
        
        // If it's a Date object, convert to ISO string
        if (timestampValue instanceof Date) {
          rawTimestamp = timestampValue.toISOString();
          // Also extract time for display
          const hours = String(timestampValue.getHours()).padStart(2, '0');
          const minutes = String(timestampValue.getMinutes()).padStart(2, '0');
          timeOfDay = `${hours}:${minutes}`;
        } else if (typeof timestampValue === 'string' && timestampValue.trim() !== '') {
          // Return the string as-is
          rawTimestamp = timestampValue.trim();
        } else {
          // Try to convert to string
          rawTimestamp = String(timestampValue);
        }
        
        // Store raw timestamp string for client-side parsing
        if (rawTimestamp) {
          if (isCompleted) {
            rawTimestamps.push(rawTimestamp);
          } else {
            rawTimestampsIncomplete.push(rawTimestamp);
          }
        }
      }

      // Parse answers safely
      let answersArray = [];
      if (answersIndex !== -1 && row[answersIndex]) {
        try {
          const parsed = JSON.parse(row[answersIndex]);
          if (Array.isArray(parsed)) {
            answersArray = parsed;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      players.push({ 
        name: name, 
        score: score, 
        totalQuestions: finalTotalQuestions,
        time: timeOfDay, 
        rawTimestamp: rawTimestamp,
        completed: isCompleted,
        answers: answersArray
      });
    });
    
    // Separate completed and incomplete players
    const completedPlayers = players.filter(p => p.completed);
    const incompletePlayers = players.filter(p => !p.completed);
    
    const completedCount = completedPlayers.length;
    const incompleteCount = incompletePlayers.length;
    
    // Calculate average scores separately
    let totalScoreCompleted = 0;
    completedPlayers.forEach(p => totalScoreCompleted += p.score);
    let averageScoreCompleted = 0;
    if (completedCount > 0) {
      averageScoreCompleted = (totalScoreCompleted / completedCount).toFixed(1);
    }
    
    let totalScoreIncomplete = 0;
    incompletePlayers.forEach(p => totalScoreIncomplete += p.score);
    let averageScoreIncomplete = 0;
    if (incompleteCount > 0) {
      averageScoreIncomplete = (totalScoreIncomplete / incompleteCount).toFixed(1);
    }
    
    // Overall average (for backward compatibility - only completed)
    const averageScore = averageScoreCompleted;
    
    // Sort by score descending (return all, not just top 5)
    completedPlayers.sort((a, b) => b.score - a.score);
    const topScores = completedPlayers; // Return all completed quizzes
    
    // Also include incomplete quizzes (sorted by score, return all)
    incompletePlayers.sort((a, b) => b.score - a.score);
    const topIncomplete = incompletePlayers; // Return all incomplete quizzes
    
    return ContentService
      .createTextOutput(JSON.stringify({
        result: "success",
        totalPlayers: completedCount, // Only completed for main metric
        averageScore: averageScore, // Average of completed quizzes
        completedCount: completedCount, // Explicit count of completed
        incompleteCount: incompleteCount, // Explicit count of incomplete
        averageScoreCompleted: averageScoreCompleted, // Average score of completed quizzes
        averageScoreIncomplete: averageScoreIncomplete, // Average score of incomplete quizzes
        topScores: topScores, // Top completed quizzes
        topIncomplete: topIncomplete, // Top incomplete quizzes
        rawTimestamps: rawTimestamps, // Raw timestamp strings for completed quizzes
        rawTimestampsIncomplete: rawTimestampsIncomplete // Raw timestamp strings for incomplete quizzes
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        result: "error",
        message: "Failed to retrieve metrics",
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
