// Enhanced error handling for emandate operations
const handleEmandateError = (error, context = {}) => {
  const errorInfo = {
    message: error.message || 'Unknown error',
    code: error.code || error.statusCode || 'UNKNOWN_ERROR',
    context,
    timestamp: new Date().toISOString()
  };
  
  // Determine user-friendly message and suggestions
  let userMessage = 'An unexpected error occurred. Please try again.';
  let suggestions = [];
  let httpStatus = 500;
  
  if (error.message?.includes('SERVER_ERROR') || error.code === 'SERVER_ERROR') {
    userMessage = 'Payment service is temporarily unavailable. Please try again in a few minutes.';
    suggestions = [
      'Wait 5-10 minutes and try again',
      'Try using one-time payment instead',
      'Contact support if the issue persists'
    ];
    httpStatus = 503;
  } else if (error.message?.includes('BAD_REQUEST') || error.code === 'BAD_REQUEST') {
    userMessage = 'Invalid request. Please check your information and try again.';
    suggestions = [
      'Verify your email address',
      'Check your phone number format',
      'Try refreshing the page'
    ];
    httpStatus = 400;
  } else if (error.message?.includes('customer') || error.message?.includes('Customer')) {
    userMessage = 'Unable to create customer profile. Please check your details.';
    suggestions = [
      'Verify your email address is correct',
      'Ensure your name contains only letters',
      'Try a different email if available'
    ];
    httpStatus = 400;
  } else if (error.message?.includes('network') || error.message?.includes('timeout')) {
    userMessage = 'Network connection issue. Please check your internet and try again.';
    suggestions = [
      'Check your internet connection',
      'Try again in a few minutes',
      'Use a different network if available'
    ];
    httpStatus = 503;
  }
  
  return {
    success: false,
    error: userMessage,
    code: errorInfo.code,
    suggestions,
    timestamp: errorInfo.timestamp,
    httpStatus
  };
};

module.exports = { handleEmandateError };
