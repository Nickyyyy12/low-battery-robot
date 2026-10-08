package clawd;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 极简 JSON 解析器，只用于读取用量接口和本地日志，省掉第三方依赖。
 * 对象 → Map，数组 → List，数字 → Double，其余照常。
 */
final class Json {
    private final String s;
    private int i;

    private Json(String s) {
        this.s = s;
    }

    static Object parse(String text) {
        Json p = new Json(text);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i != p.s.length()) {
            throw p.error("多余的字符");
        }
        return v;
    }

    // ---------- 取值小工具 ----------

    @SuppressWarnings("unchecked")
    static Map<String, Object> obj(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    static Map<String, Object> obj(Map<String, Object> m, String key) {
        return m == null ? null : obj(m.get(key));
    }

    static String str(Map<String, Object> m, String key) {
        Object v = m == null ? null : m.get(key);
        return v instanceof String ? (String) v : null;
    }

    static Double num(Map<String, Object> m, String key) {
        Object v = m == null ? null : m.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    static long lng(Map<String, Object> m, String key) {
        Double d = num(m, key);
        return d == null ? 0 : d.longValue();
    }

    // ---------- 解析 ----------

    private Object value() {
        if (i >= s.length()) {
            throw error("意外结束");
        }
        switch (s.charAt(i)) {
            case '{':
                return object();
            case '[':
                return array();
            case '"':
                return string();
            case 't':
                literal("true");
                return Boolean.TRUE;
            case 'f':
                literal("false");
                return Boolean.FALSE;
            case 'n':
                literal("null");
                return null;
            default:
                return number();
        }
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++;
        ws();
        if (at('}')) {
            i++;
            return m;
        }
        while (true) {
            ws();
            if (!at('"')) {
                throw error("需要键名");
            }
            String key = string();
            ws();
            if (!at(':')) {
                throw error("需要冒号");
            }
            i++;
            ws();
            m.put(key, value());
            ws();
            if (at(',')) {
                i++;
            } else if (at('}')) {
                i++;
                return m;
            } else {
                throw error("需要 , 或 }");
            }
        }
    }

    private List<Object> array() {
        List<Object> list = new ArrayList<>();
        i++;
        ws();
        if (at(']')) {
            i++;
            return list;
        }
        while (true) {
            ws();
            list.add(value());
            ws();
            if (at(',')) {
                i++;
            } else if (at(']')) {
                i++;
                return list;
            } else {
                throw error("需要 , 或 ]");
            }
        }
    }

    private String string() {
        i++; // 跳过开头的引号
        StringBuilder sb = new StringBuilder();
        while (i < s.length()) {
            char c = s.charAt(i++);
            if (c == '"') {
                return sb.toString();
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            if (i >= s.length()) {
                break;
            }
            char e = s.charAt(i++);
            switch (e) {
                case 'n': sb.append('\n'); break;
                case 't': sb.append('\t'); break;
                case 'r': sb.append('\r'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'u':
                    if (i + 4 > s.length()) {
                        throw error("\\u 转义不完整");
                    }
                    sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                    break;
                default: sb.append(e); // " \ /
            }
        }
        throw error("字符串没有结束");
    }

    private Double number() {
        int start = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
            i++;
        }
        if (start == i) {
            throw error("无法识别的字符");
        }
        return Double.parseDouble(s.substring(start, i));
    }

    private void literal(String word) {
        if (!s.startsWith(word, i)) {
            throw error("需要 " + word);
        }
        i += word.length();
    }

    private boolean at(char c) {
        return i < s.length() && s.charAt(i) == c;
    }

    private void ws() {
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) {
            i++;
        }
    }

    private IllegalArgumentException error(String msg) {
        return new IllegalArgumentException("JSON 解析失败（位置 " + i + "）：" + msg);
    }
}
