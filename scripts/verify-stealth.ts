import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// @ts-ignore
puppeteer.use(StealthPlugin());

async function verify() {
    console.log("Iniciando verificação de stealth...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        const page = await browser.newPage();

        console.log("Navegando para bot.sannysoft.com...");
        await page.goto("https://bot.sannysoft.com/");

        // Aguardar os testes carregarem
        await new Promise((r) => setTimeout(r, 5000));

        const screenshotPath = "stealth-check.png";
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot salva em: ${screenshotPath}`);

        const results = await page.evaluate(() => {
            return {
                webdriver:
                    document.getElementById("webdriver-result")?.innerText,
                chrome: document.getElementById("chrome-result")?.innerText,
                permissions:
                    document.getElementById("permissions-result")?.innerText,
                plugins: document.getElementById("plugins-result")?.innerText,
            };
        });

        console.log("Resultados do teste de stealth:", results);

        if (results.webdriver === "missing (OK)") {
            console.log("✅ Stealth parece estar funcionando!");
        } else {
            console.log("❌ Stealth falhou. O site ainda detecta automação.");
        }
    } catch (err) {
        console.error("Erro durante a verificação:", err);
    } finally {
        await browser.close();
    }
}

verify();
