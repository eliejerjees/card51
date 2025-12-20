package card51;

import java.util.*;
import static card51.GroupValidator.AceMode;

public class GameUtils {
    // find all valid sets
    public static List<List<Card>> findSets(List<Card> hand) {
        List<List<Card>> sets = new ArrayList<>();
        combine(hand, 3, 0, new ArrayList<>(), sets, true, null);
        combine(hand, 4, 0, new ArrayList<>(), sets, true, null);
        return sets;
    }

    // find all valid runs
    public static List<List<Card>> findRuns(List<Card> hand, AceMode mode) {
        List<List<Card>> runs = new ArrayList<>();
        for (int size=3; size<=hand.size(); size++) {
            combine(hand, size, 0, new ArrayList<>(), runs, false, mode);
        }
        return runs;
    }

    private static void combine(List<Card> hand, int size, int start,
                                List<Card> temp, List<List<Card>> out,
                                boolean setMode, AceMode mode) {
        if (temp.size()==size) {
            if (setMode && GroupValidator.isValidSet(temp)) out.add(new ArrayList<>(temp));
            if (!setMode && GroupValidator.isValidRun(temp, mode)) out.add(new ArrayList<>(temp));
            return;
        }
        for (int i=start; i<hand.size(); i++) {
            temp.add(hand.get(i));
            combine(hand, size, i+1, temp, out, setMode, mode);
            temp.remove(temp.size()-1);
        }
    }
}