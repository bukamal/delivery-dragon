// التحقق من صحة initData من تيليجرام
export async function verifyTelegramWebAppData(initData, botToken) {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    
    const sortedKeys = Array.from(urlParams.keys()).sort();
    const dataCheckString = sortedKeys.map(key => `${key}=${urlParams.get(key)}`).join('\n');
    
    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode('WebAppData'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
    
    const hmacKey = await crypto.subtle.importKey(
        'raw',
        signature,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const calculatedSignature = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(dataCheckString));
    const calculatedHash = Array.from(new Uint8Array(calculatedSignature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    return calculatedHash === hash;
}

export async function getUserFromInitData(initData, botToken) {
    if (!initData) return null;
    const isValid = await verifyTelegramWebAppData(initData, botToken);
    if (!isValid) return null;
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return null;
    try {
        return JSON.parse(userString);
    } catch {
        return null;
    }
}
