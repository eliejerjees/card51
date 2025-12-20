package card51;

import java.util.*;

public class GroupValidator {
    public enum AceMode {
        LOW, HIGH
    }

    public static boolean isValidSet(List<Card> cards) {
        if (cards.size() < 3 || cards.size() > 4)
            return false;
        Set<Card.Suit> suits = new HashSet<>();
        Card.Rank rank = null;
        int jokers = 0;
        for (Card c : cards) {
            if (c.isJoker())
                jokers++;
            else {
                if (rank == null)
                    rank = c.getRank();
                else if (c.getRank() != rank)
                    return false;
                suits.add(c.getSuit());
            }
        }
        return suits.size() + jokers == cards.size();
    }

    public static boolean isValidRun(List<Card> cards, AceMode mode) {
        if (cards.size() < 3)
            return false;
        List<Card> sorted = new ArrayList<>(cards);
        sorted.sort(Comparator.comparingInt(c -> getRankIndex(c.getRank(), mode)));
        Card.Suit suit = null;
        int jokers = 0;
        for (Card c : sorted) {
            if (c.isJoker())
                jokers++;
            else {
                if (suit == null)
                    suit = c.getSuit();
                else if (c.getSuit() != suit)
                    return false;
            }
        }
        int gaps = 0;
        for (int i = 1; i < sorted.size(); i++) {
            Card prev = sorted.get(i - 1), curr = sorted.get(i);
            if (prev.isJoker() || curr.isJoker())
                continue;
            int diff = getRankIndex(curr.getRank(), mode) - getRankIndex(prev.getRank(), mode) - 1;
            if (diff > 0) {
                gaps += diff;
                if (gaps > jokers)
                    return false;
            }
        }
        return true;
    }

    private static int getRankIndex(Card.Rank rank, AceMode mode) {
        switch (rank) {
            case TWO:
                return 2;
            case THREE:
                return 3;
            case FOUR:
                return 4;
            case FIVE:
                return 5;
            case SIX:
                return 6;
            case SEVEN:
                return 7;
            case EIGHT:
                return 8;
            case NINE:
                return 9;
            case TEN:
                return 10;
            case JACK:
                return 11;
            case QUEEN:
                return 12;
            case KING:
                return 13;
            case ACE:
                return (mode == AceMode.HIGH ? 14 : 1);
            default:
                return 0;
        }
    }

    public static int getGroupPoints(List<Card> cards) {
        int sum = 0;
        for (Card c : cards)
            sum += c.getValue();
        return sum;
    }
}