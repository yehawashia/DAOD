export function useTextResolver() {
  const resolve = (
    targetString: string,
    onUpdate: (text: string) => void,
    onComplete?: () => void,
    options = { timeout: 5, iterations: 10 }
  ) => {
    const characters = [
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
      'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
      'u', 'v', 'x', 'y', '#', '%', '&', '-', '+', '_', '?', '/', '\\', '='
    ];

    let iteration = 0;
    let isActive = true;

    const interval = setInterval(() => {
      if (!isActive) return;

      const result = targetString
        .split("")
        .map((char, index) => {
          if (char === " ") return " ";
          // If the iteration has passed this character's index, reveal it
          if (index < Math.floor(iteration)) {
            return targetString[index];
          }
          // Otherwise, scramble it
          return characters[Math.floor(Math.random() * characters.length)];
        })
        .join("");

      onUpdate(result);

      // We are done when the iteration passes the last character
      if (iteration >= targetString.length) {
        clearInterval(interval);
        isActive = false;
        onUpdate(targetString);
        if (onComplete) onComplete();
      }

      // Increase slowly to get [options.iterations] scrambles per character
      iteration += 1 / options.iterations;
    }, options.timeout);

    // Return a cleanup function to allow aborting the resolve early
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  };

  return { resolve };
}
