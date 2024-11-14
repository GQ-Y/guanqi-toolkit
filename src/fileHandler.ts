const openFile = (uri) => {
    if (!uri) {
        console.error('URI is null or undefined');
        return;
    }
    
    const scheme = uri?.scheme || 'file';
    // ...
} 